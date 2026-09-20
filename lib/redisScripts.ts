/** Redis Lua scripts used by the cache layer. */

/** SET NX PX lock; returns {acquired, pttl}. */
export const ACQUIRE_LOCK_SCRIPT = `
local ok = redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX')
if ok then
    return {1, tonumber(ARGV[2])}
end
return {0, redis.call('PTTL', KEYS[1])}
`;

/** Release only if the caller still owns the lock. */
export const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
`;

/**
 * Remove one search result by downloadUrl.
 * Document root is a JSON array of result objects.
 */
export const REMOVE_SEARCH_RESULT_SCRIPT = `
local raw = redis.call('JSON.GET', KEYS[1], '$')
if not raw then return 0 end

local decoded = cjson.decode(raw)
local list = decoded[1]
if type(list) ~= 'table' then return 0 end

local idx = -1
for i, item in ipairs(list) do
    if item.downloadUrl == ARGV[1] then
        idx = i - 1
        break
    end
end

if idx < 0 then return 0 end

redis.call('JSON.ARRPOP', KEYS[1], '$', idx)
local len = redis.call('JSON.ARRLEN', KEYS[1], '$')
if len and len[1] == 0 then
    redis.call('DEL', KEYS[1])
end
return 1
`;

/** Pull the handful of fields the stream hot-path needs. */
export const STREAM_STATUS_SCRIPT = `
local raw = redis.call('JSON.GET', KEYS[1], '$')
if not raw then return nil end

local decoded = cjson.decode(raw)
local doc = decoded
if type(decoded) == 'table' and decoded[1] ~= nil and type(decoded[1]) == 'table' then
    doc = decoded[1]
end
if type(doc) ~= 'table' then return nil end

local function s(v)
    if v == nil or v == cjson.null then return '' end
    return tostring(v)
end

return {
    s(doc.status),
    s(doc.failureMessage),
    s(doc.nzoId),
    s(doc.viewPath),
    s(doc.fileName)
}
`;

/** @deprecated Use STREAM_STATUS_SCRIPT */
export const FAST_FAIL_SCRIPT = STREAM_STATUS_SCRIPT;

/** @deprecated Use REMOVE_SEARCH_RESULT_SCRIPT */
export const REMOVE_PROWLARR_SCRIPT = REMOVE_PROWLARR_SCRIPT;
