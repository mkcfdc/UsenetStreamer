// ═══════════════════════════════════════════════════════════════════
// Optimized Redis Lua Scripts
// ═══════════════════════════════════════════════════════════════════

/**
 * ACQUIRE_LOCK_SCRIPT
 * Perfectly optimized. Just formatted with template literals for readability.
 */
export const ACQUIRE_LOCK_SCRIPT = `
    local result = redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX')
    if result then 
        return {1, tonumber(ARGV[2])} 
    end
    return {0, redis.call('PTTL', KEYS[1])}
`;

/**
 * REMOVE_PROWLARR_SCRIPT
 * Optimization: Removed the redundant 'EXISTS' check.
 * Optimization: Fixed the JSON.ARRLEN return value parsing to correctly trigger the DEL cleanup.
 */
export const REMOVE_PROWLARR_SCRIPT = `
    local k = KEYS[1]
    
    -- JSON.GET natively returns nil if missing, saving an EXISTS operation
    local a = redis.call('JSON.GET', k, '$')
    if not a then return 0 end
    
    local d = cjson.decode(a)
    local t = d[1]
    if not t or type(t) ~= 'table' then return 0 end
    
    local x = -1
    for i, v in ipairs(t) do 
        if v.downloadUrl == ARGV[1] then 
            x = i - 1 
            break 
        end 
    end
    
    if x >= 0 then 
        redis.call('JSON.ARRPOP', k, '$', x)
        
        -- '$' returns an array of lengths for all matches. We check the first result.
        local l = redis.call('JSON.ARRLEN', k, '$')
        if l and l[1] == 0 then 
            redis.call('DEL', k) 
        end
        return 1 
    end
    
    return 0
`;

/**
 * FAST_FAIL_SCRIPT
 * CRITICAL OPTIMIZATION: Instead of decoding the entire document in Lua,
 * we use the RedisJSON native C-engine to extract ONLY the 5 specific fields we need.
 * This prevents blocking the Redis thread on large JSON documents.
 */
export const FAST_FAIL_SCRIPT = `
    local k = KEYS[1]
    
    -- Extract ONLY targeted fields. Fast and lightweight!
    local j = redis.call('JSON.GET', k, '$.status', '$.failureMessage', '$.nzoId', '$.viewPath', '$.fileName')
    if not j then return nil end
    
    local d = cjson.decode(j)
    
    -- RedisJSON multiple paths return objects wrapped in arrays, e.g., {"$.status":["failed"]}
    local function get_val(path)
        if d[path] and d[path][1] then 
            return d[path][1] 
        else 
            return '' 
        end
    end

    return {
        get_val('$.status'),
        get_val('$.failureMessage'),
        get_val('$.nzoId'),
        get_val('$.viewPath'),
        get_val('$.fileName')
    }
`;
