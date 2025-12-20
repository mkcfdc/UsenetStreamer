export const ACQUIRE_LOCK_SCRIPT =
    `local key=KEYS[1];` +
    `local value=ARGV[1];` +
    `local ttl=ARGV[2];` +
    `local result=redis.call('SET',key,value,'PX',ttl,'NX');` +
    `if result then return {1,tonumber(ttl)} end;` +
    `local remaining=redis.call('PTTL',key);` +
    `return {0,remaining};`;

export const REMOVE_PROWLARR_SCRIPT =
    `local k=KEYS[1];if redis.call("EXISTS",k)==0 then return 0 end;local a=redis.call('JSON.GET',k,'$');if not a then return 0 end;local d=cjson.decode(a);local t=d[1];if not t then return 0 end;local x=-1;for i,v in ipairs(t) do if v.downloadUrl==ARGV[1] then x=i-1;break end end;if x>=0 then redis.call('JSON.ARRPOP',k,'$',x);local l=redis.call('JSON.ARRLEN',k,'$[0]') or 0;if l==0 then redis.call('DEL',k) end;return 1 end;return 0`;

export const FAST_FAIL_SCRIPT =
    `local k=KEYS[1];` +
    `if redis.call('EXISTS',k)==0 then return nil end;` +
    `local j=redis.call('JSON.GET',k,'$');` +
    `if not j then return nil end;` +
    `local d=cjson.decode(j);` +
    `local o=d[1];` +
    `if not o then return nil end;` +
    `return {` +
    `o.status or '',` +
    `o.failureMessage or '',` +
    `o.nzoId or '',` +
    `o.viewPath or '',` +
    `o.fileName or ''` +
    `};`;
