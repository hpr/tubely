import { respondWithJSON } from "./json";
import { type ApiConfig } from "../config";
import { file, write, type BunRequest } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest<":videoId">) {
  const MAX_UPLOAD_SIZE = 1 << 30; // 1 GB
  const userID = validateJWT(getBearerToken(req.headers), cfg.jwtSecret);
  const video = getVideo(cfg.db, req.params.videoId);
  if (userID !== video?.userID) throw new UserForbiddenError("bad user");
  const fdVideo = (await req.formData()).get("video");
  if (!(fdVideo instanceof File)) throw new BadRequestError("bad video file");
  if (fdVideo.size > MAX_UPLOAD_SIZE) throw new BadRequestError("bad video size");
  if (fdVideo.type !== "video/mp4") throw new BadRequestError("bad video type");
  const fname = `${randomBytes(32).toString("base64url")}.mp4`;
  const tmpPath = join(tmpdir(), fname);
  await write(tmpPath, await fdVideo.bytes());
  const tmpFile = file(tmpPath);
  await cfg.s3Client.file(fname).write(tmpFile, { type: fdVideo.type });
  await tmpFile.delete();
  video.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${fname}`;
  updateVideo(cfg.db, video);
  return respondWithJSON(200, null);
}
