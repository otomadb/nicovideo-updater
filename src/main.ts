import { PrismaClient } from "@prisma/client";
import winston from "winston";
import ky, { HTTPError, TimeoutError } from "ky";

import { z } from "zod";

const prisma = new PrismaClient();
const logger = winston.createLogger({
  level: "debug",
  format: winston.format.json(),
});

if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({ format: winston.format.simple() })
  );
}

const sources = await prisma.nicovideoVideoSource.findMany({
  where: {
    OR: [{ registeredAt: null }, { account: null }],
  },
  select: {
    id: true,
    sourceId: true,
  },
});

logger.info({ message: "Estimated update count", count: sources.length });

const tx: ReturnType<typeof prisma.nicovideoVideoSource.update>[] = [];
for (const { id, sourceId } of sources) {
  const url = new URL(
    `/api/watch/v3_guest/${sourceId}`,
    "https://www.nicovideo.jp"
  );
  url.searchParams.set("_frontendId", "6");
  url.searchParams.set("_frontendVersion", "0");
  url.searchParams.set("skips", "harmful");
  url.searchParams.set(
    "actionTrackId",
    `${Math.random().toString(36).substring(2)}_${Date.now()}`
  );

  try {
    logger.debug({
      message: "Fetching from Nicovideo api",
      url: url.toString(),
    });
    const json = await ky
      .get(url.toString(), {
        timeout: 5000,
        retry: 2,
        headers: { Accept: "*/*" },
      })
      .json();

    const {
      data: {
        video: { registeredAt },
        owner,
      },
    } = z
      .object({
        data: z.object({
          tag: z.object({
            items: z.array(z.object({ name: z.string() })),
          }),
          video: z.object({
            id: z.string(),
            title: z.string(),
            registeredAt: z.preprocess((arg) => {
              if (typeof arg === "string" || arg instanceof Date)
                return new Date(arg);
            }, z.date()),
          }),
          owner: z
            .object({
              id: z.number(),
              nickname: z.string(),
              iconUrl: z.string().url(),
            })
            .nullable(),
        }),
      })
      .parse(json);

    tx.push(
      prisma.nicovideoVideoSource.update({
        where: { id },
        data: {
          registeredAt: registeredAt,
          account: owner
            ? {
                connectOrCreate: {
                  where: {
                    accountId: owner.id.toString(10),
                  },
                  create: {
                    accountId: owner.id.toString(10),
                    name: owner.nickname,
                  },
                  /*
                  update: {
                    name: owner.nickname,
                  },
                  */
                },
              }
            : undefined,
        },
      })
    );
    logger.info({
      message: "Fetch from Nicovideo api successfully",
      sourceId: sourceId,
    });
  } catch (e) {
    if (e instanceof HTTPError) {
      logger.warn({
        message: "Feiled to fetch from Nicovideo api",
        sourceId: sourceId,
        url: url.toString(),
        error: e.message,
      });
    } else if (e instanceof TimeoutError) {
      logger.warn({
        message: "Timeout fetching from Nicovideo api",
        sourceId: sourceId,
        url: url.toString(),
        error: e.message,
      });
    } else {
      logger.error({
        message: "Unknown error in fetching from Nicovideo api",
        sourceId: sourceId,
        url: url.toString(),
        error: e,
      });
    }
  }
}

try {
  await prisma.$transaction(tx);
  logger.info("Update successfully");
} catch (e) {
  logger.error({
    message: "Update failed",
    error: e,
  });
}
