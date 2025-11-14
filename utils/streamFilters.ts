// Idea for this came from BRNKR
// https://github.com/BRNKR/UsenetStreamer
// Used the Prism format.

import { type ParsedFilename, type ParsedShow } from "@ctrl/video-filename-parser";

interface FormatVideoCardOptions {
  size?: string | null;        // GB
  totalSize?: string | null;   // GB
  proxied?: boolean;          // true / false
  source?: string;            // e.g., 'Usenet', 'Torrent'
  age?: number | null;        // days
  grabs?: number | null;      // number of grabs
  message?: string;           // additional message
}

export function formatVideoCard(parsed: ParsedFilename | ParsedShow, options: FormatVideoCardOptions = {}) {
  const {
    size = null,       // GB
    totalSize = null,  // GB
    proxied = false,   // true / false
    source = 'Usenet',
    age = null,
    grabs = null,
    message = ''
  } = options;

  const isTv = 'isTv' in parsed && parsed.isTv;
  const isFullSeason = 'fullSeason' in parsed && parsed.fullSeason === true;

  const episodeString =
    isTv && !isFullSeason && 'seasons' in parsed && 'episodeNumbers' in parsed
      ? ` S${parsed.seasons?.[0]?.toString().padStart(2, '0')}E${parsed.episodeNumbers?.[0]?.toString().padStart(2, '0')}`
      : '';

  // Title + Year
  const titleLine = `🎬 ${parsed.title}${parsed.year ? ` (${parsed.year})` : ''} ` + episodeString;

  // Source / Resolution / Codec / Duration placeholder
  const resolution = parsed.resolution || 'Unknown';
  // Source
  const sourceType = parsed.sources?.[0]?.toUpperCase();
  const videoCodec = parsed.videoCodec?.toUpperCase();
  const editionBadges = [];

  if (parsed.edition?.dolbyVision) editionBadges.push('DV');
  if (parsed.edition?.hdr) editionBadges.push('HDR');

  const editionLine = editionBadges.join(' ');

  // Build video line dynamically
  const videoParts = [
    sourceType && `🎥 ${sourceType}`,
    editionLine && editionLine,
    videoCodec && `🎞️ ${videoCodec}`,
  ].filter(Boolean);

  const videoLine = videoParts.join(' ');

  // Audio
  const audioParts = [
    parsed.audioCodec && `🎧 ${parsed.audioCodec}`,
    parsed.audioChannels && `🔊 ${parsed.audioChannels}`,
    parsed.languages?.length && `🗣️ ${parsed.languages.join(' / ')}`,
  ].filter(Boolean);

  const audioLine = audioParts.join(' ');

  // Size & Group
  const sizeParts = [];

  if (size && totalSize) {
    sizeParts.push(`📦 ${size} GB / ${totalSize} GB`);
  } else if (size) {
    sizeParts.push(`📦 ${size} GB`);
  } else if (totalSize) {
    sizeParts.push(`📦 ${totalSize} GB`);
  }
  if (parsed.group) sizeParts.push(`🏷️ ${parsed.group}`);
  if (source) sizeParts.push(`🔍 ${source}`);
  // sizeParts.push(`📡 RARBG`);

  const sizeLine = sizeParts.join(' ');

  const ageParts = [];
  if (age !== null) ageParts.push(`⏳ ${age} days old`);
  if (grabs !== null) ageParts.push(`🤲 ${grabs} grabs`);
  const ageLine = ageParts.join(' ');

  // Proxy / source info
  const proxyParts = [
    `🔓 ${proxied ? 'Proxied' : 'Not Proxied'}`,
  ].filter(Boolean);

  const _proxyLine = proxyParts.join(' ');

  const lines = [titleLine, videoLine, audioLine, ageLine, sizeLine].filter(Boolean).join('\n');
  // Combine lines
  return {
    resolution,
    lines
  };
}