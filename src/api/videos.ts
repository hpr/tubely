import { respondWithJSON } from "./json";
import { type ApiConfig } from "../config";
import { file, spawn, write, type BunRequest } from "bun";
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
  const key = `${await getVideoAspectRatio(tmpPath)}/${fname}`;
  await cfg.s3Client.file(key).write(tmpFile, { type: fdVideo.type });
  await tmpFile.delete();
  video.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`;
  updateVideo(cfg.db, video);
  return respondWithJSON(200, null);
}

type FFProbe = {
  programs: [];
  stream_groups: [];
  streams: {
    width: number;
    height: number;
  }[];
};

export async function getVideoAspectRatio(filePath: string) {
  const proc = spawn(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", filePath], {
    stderr: "pipe",
    stdout: "pipe",
  });
  if (await proc.exited !== 0) throw Error(await new Response(proc.stderr).text());
  const { streams }: FFProbe = JSON.parse(await new Response(proc.stdout).text());
  return ({
    1: "landscape",
    0: "portrait",
  } as const)[Math.floor(streams[0].width / streams[0].height)] ?? "other";
}
