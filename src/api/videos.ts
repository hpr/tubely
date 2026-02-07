import { respondWithJSON } from "./json";
import { type ApiConfig } from "../config";
import { file, spawn, write, type BunRequest } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo, type Video } from "../db/videos";
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
  const processedPath = await processVideoForFastStart(tmpPath);
  await file(tmpPath).delete();
  const processedFile = file(processedPath);
  const key = `${await getVideoAspectRatio(processedPath)}/${fname}`;
  await cfg.s3Client.file(key).write(processedFile, { type: fdVideo.type });
  await processedFile.delete();
  const videoWithURL = Object.assign({}, video, { videoURL: `${cfg.s3CfDistribution}${key}` });
  updateVideo(cfg.db, videoWithURL);
  return respondWithJSON(200, videoWithURL);
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

export async function processVideoForFastStart(filePath: string) {
  const fname = `${filePath}.processed`;
  const proc = spawn(["ffmpeg", "-i", filePath, "-movflags", "faststart", "-map_metadata", "0", "-codec", "copy", "-f", "mp4", fname]);
  if (await proc.exited !== 0) throw Error(await new Response(proc.stderr).text());
  return fname;
}
