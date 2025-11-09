// Idea for this came from BRNKR
// https://github.com/BRNKR/UsenetStreamer
// Used the Prism format.


export function formatVideoCard(parsed, options = {}) {
  const {
    size = null,       // GB
    totalSize = null,  // GB
    proxied = false,   // true / false
    source = 'Usenet',
    message = ''
  } = options;

  // Title + Year
  const titleLine = `🎬 ${parsed.title}${parsed.year ? ` (${parsed.year})` : ''}`;

  // Source / Resolution / Codec / Duration placeholder
  const resolution = parsed.resolution || 'Unknown';
  // Source
  const sourceType = parsed.sources?.[0]?.toUpperCase();
  const videoCodec = parsed.videoCodec?.toUpperCase();
  const editionBadges = [];

  if (parsed.edition?.dolbyVision) editionBadges.push('DV');
  if (parsed.edition?.hdr) editionBadges.push('HDR');

  const editionLine = editionBadges.join(' ');

  // Duration (formatted only if present)
  const duration = parsed.runtime ? formatDuration(parsed.runtime) : null;

  // Build video line dynamically
  const videoParts = [
    sourceType && `🎥 ${sourceType}`,
    editionLine && editionLine,
    videoCodec && `🎞️ ${videoCodec}`,
    duration && `⏱️ ${duration}`,
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
  // sizeParts.push(`📡 RARBG`);

  const sizeLine = sizeParts.join(' ');

  // Proxy / source info
  const proxyParts = [
    `🔓 ${proxied ? 'Proxied' : 'Not Proxied'}`,
    source && `🔍 ${source}`,
  ].filter(Boolean);

  const proxyLine = proxyParts.join(' ');

  const lines = [titleLine, videoLine, audioLine, sizeLine, proxyLine].filter(Boolean).join('\n');
  // Combine lines
  return {
    resolution,
    lines
  };
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h:${m}m:${s}s`;
}