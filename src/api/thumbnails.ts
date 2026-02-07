import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import { write, type BunRequest } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import { join } from "path";
import { extension } from "mime-types";

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
  if (!(thumbnail instanceof File)) throw new BadRequestError("bad thumbnail file");
  if (thumbnail.size > MAX_UPLOAD_SIZE) throw new BadRequestError("bad thumbnail size");
  const video = getVideo(cfg.db, videoId);
  if (userID !== video?.userID) throw new UserForbiddenError("bad user");
  if (!["image/jpeg", "image/png"].includes(thumbnail.type)) throw new BadRequestError("bad thumbnail type");
  const fname = `${video.id}.${extension(thumbnail.type)}`;
  await write(join(cfg.assetsRoot, fname), await thumbnail.bytes());
  video.thumbnailURL = `http://localhost:${cfg.port}/${cfg.assetsRoot}/${fname}`;
  updateVideo(cfg.db, video);

  return respondWithJSON(200, video);
}
