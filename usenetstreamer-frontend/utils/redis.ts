import { connect } from "@db/redis";

export const redis = await connect({
    hostname: "192.168.0.215",
    port: 6379,
});

export default redis;