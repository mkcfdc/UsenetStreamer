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
local raw = redis.call('JSON.GET', KEYS[1], '$.status', '$.failureMessage', '$.nzoId', '$.viewPath', '$.fileName')
if not raw then return nil end

local doc = cjson.decode(raw)
local function first(path)
    local node = doc[path]
    if type(node) == 'table' and node[1] ~= nil then
        return node[1]
    end
    return ''
end

return {
    first('$.status'),
    first('$.failureMessage'),
    first('$.nzoId'),
    first('$.viewPath'),
    first('$.fileName')
}
`;

/** @deprecated Use STREAM_STATUS_SCRIPT */
export const FAST_FAIL_SCRIPT = STREAM_STATUS_SCRIPT;

/** @deprecated Use REMOVE_SEARCH_RESULT_SCRIPT */
export const REMOVE_PROWLARR_SCRIPT = REMOVE_SEARCH_RESULT_SCRIPT;
