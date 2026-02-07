import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

const videoThumbnails: Map<string, Thumbnail> = new Map();

export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  const thumbnail = videoThumbnails.get(videoId);
  if (!thumbnail) {
    throw new NotFoundError("Thumbnail not found");
  }

  return new Response(thumbnail.data, {
    headers: {
      "Content-Type": thumbnail.mediaType,
      "Cache-Control": "no-store",
    },
  });
}

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const MAX_UPLOAD_SIZE = 10 << 20; // 10 MB
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const thumbnail = (await req.formData()).get("thumbnail");
  if (!(thumbnail instanceof File)) throw new BadRequestError("bad thumbnail type");
  if (thumbnail.size > MAX_UPLOAD_SIZE) throw new BadRequestError("bad thumbnail size");
  const video = getVideo(cfg.db, videoId);
  if (userID !== video?.userID) throw new UserForbiddenError("bad user");
  videoThumbnails.set(video.id, { data: await thumbnail.arrayBuffer(), mediaType: thumbnail.type });
  video.thumbnailURL = `http://localhost:${cfg.port}/api/thumbnails/${video.id}`;
  updateVideo(cfg.db, video);

  return respondWithJSON(200, video);
}
