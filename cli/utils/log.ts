export const CSS = {
    title: "color: #5ed3f3; font-weight: bold; font-size: 1.2em;",
    header: "color: #ecc94b; font-weight: bold;",
    success: "color: #48bb78; font-weight: bold;",
    error: "color: #f56565; font-weight: bold;",
    mute: "color: #718096;",
    highlight: "color: #63b3ed;",
    warn: "color: #ed8936; font-weight: bold;",
    bold: "font-weight: bold;",
};

export const log = {
    title: (msg: string) => console.log(`%c${msg}`, CSS.title),
    header: (msg: string) => console.log(`%c${msg}`, CSS.header),
    success: (msg: string) => console.log(`%c${msg}`, CSS.success),
    error: (msg: string) => console.error(`%c${msg}`, CSS.error),
    warn: (msg: string) => console.log(`%c${msg}`, CSS.warn),
    info: (msg: string) => console.log(`%c${msg}`, CSS.highlight),
    mute: (msg: string) => console.log(`%c${msg}`, CSS.mute),
};