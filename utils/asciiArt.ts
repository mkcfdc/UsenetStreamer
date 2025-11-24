// prettier-ignore
// deno-fmt-ignore

function getConsoleWidth(defaultWidth = 80): number {
    try {
        return Deno.consoleSize().columns;
    } catch {
        return defaultWidth;
    }
}

function center(text: string): string {
    const width = getConsoleWidth();
    return text
        .trimEnd()
        .split("\n")
        .map(line => line.padStart((width + line.length) / 2))
        .join("\n");
}

const ascii = String.raw`
     __  __  ___  ____  _  _  ____  ____               
    (  )(  )/ __)( ___)( \( )( ___)(_  _)              
     )(__)( \__ \ )__)  )  (  )__)   )(                
    (______)(___/(____)(_)\_)(____) (__)               
     ___  ____  ____  ____    __    __  __  ____  ____ 
    / __)(_  _)(  _ \( ___)  /__\  (  \/  )( ___)(  _ \
    \__ \  )(   )   / )__)  /(__)\  )    (  )__)  )   /
    (___/ (__) (_)\_)(____)(__)(__)(_/\/\_)(____)(_)\_)

    STREAM USENET CONTENT DIRECTLY TO STREMIO!
    `;

const tagline = String.raw`
    %cDeveloped by: %cmkcfdc %c| %chttps://github.com/mkcfdc/usenetstreamer%c
    %cOriginal idea by: %cSanket9225 %c| %chttps://github.com/Sanket9225/UsenetStreamer
    `;

const centered = center(ascii);
console.log(`%c${centered}`, "color: purple; font-family: monospace; white-space: pre;");

const taglineCentered = center(tagline);
console.log(
    taglineCentered,
    "color: purple; font-family: monospace;",
    "color: orange; font-family: monospace; font-weight: bold;",
    "color: purple; font-family: monospace;",
    "color: blue; font-family: monospace; text-decoration: underline;",
    "&nbsp;",
    "color: purple; font-family: monospace;",
    "color: orange; font-family: monospace; font-weight: bold;",
    "color: purple; font-family: monospace;",
    "color: blue; font-family: monospace; text-decoration: underline;",
);
console.log("\n\n");