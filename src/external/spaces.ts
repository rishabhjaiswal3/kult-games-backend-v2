import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';

const s3 = new S3Client({
  endpoint: config.spaces.endpoint,
  region: config.spaces.region,
  credentials: {
    accessKeyId: config.spaces.key,
    secretAccessKey: config.spaces.secret,
  },
  forcePathStyle: true,
});

export function publicUrlForKey(key: string): string {
  const host = config.spaces.endpoint.replace(/^https?:\/\//, '');
  return `https://${config.spaces.bucket}.${host}/${key}`;
}

export async function generatePresignedUploadUrl(
  key: string,
  contentType?: string,
  ttlSecs = config.spaces.presignTtl,
): Promise<{ uploadUrl: string; publicUrl: string }> {
  const command = new PutObjectCommand({
    Bucket: config.spaces.bucket,
    Key: key,
    ACL: 'public-read',
    ...(contentType ? { ContentType: contentType } : {}),
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: ttlSecs });
  return { uploadUrl, publicUrl: publicUrlForKey(key) };
}

export async function fileExists(publicUrl: string): Promise<boolean> {
  const key = extractKeyFromUrl(publicUrl);
  if (!key) return false;

  try {
    await s3.send(new HeadObjectCommand({ Bucket: config.spaces.bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

function extractKeyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const bucket = config.spaces.bucket;
    const host = config.spaces.endpoint.replace(/^https?:\/\//, '');

    // Virtual hosted: https://bucket.host/key
    if (u.hostname === `${bucket}.${host}`) {
      return u.pathname.replace(/^\//, '');
    }
    // Path style: https://host/bucket/key
    const prefix = `/${bucket}/`;
    if (u.pathname.startsWith(prefix)) {
      return u.pathname.slice(prefix.length);
    }
    return null;
  } catch {
    return null;
  }
}
