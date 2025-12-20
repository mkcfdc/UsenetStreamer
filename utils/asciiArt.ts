// prettier-ignore
// deno-fmt-ignore

const PURPLE = "\x1b[35m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const UNDERLINE = "\x1b[4m";

const GRADIENT = [
    "\x1b[38;5;129m",
    "\x1b[38;5;134m",
    "\x1b[38;5;140m",
    "\x1b[38;5;146m",
    "\x1b[38;5;152m",
    "\x1b[38;5;123m",
    "\x1b[38;5;87m",
    "\x1b[38;5;81m",
    "\x1b[38;5;75m",
    "\x1b[38;5;69m",
];

const SPARKLES = ["✦", "✧", "⋆", "✺", "✹", "✸", "·", "•"];

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
        .map(line => {
            // Account for ANSI codes when calculating visible length
            const visibleLength = line.replace(/\x1b\[[0-9;]*m/g, "").length;
            const padding = Math.max(0, (width - visibleLength) / 2) | 0;
            return " ".repeat(padding) + line;
        })
        .join("\n");
}

function applyGradient(text: string): string {
    return text.split("\n").map((line, i) =>
        `${GRADIENT[i % GRADIENT.length]}${line}${RESET}`
    ).join("\n");
}

function applyHorizontalGradient(line: string): string {
    let result = "";
    const chars = [...line];
    for (let i = 0; i < chars.length; i++) {
        result += `${GRADIENT[(i / 3 | 0) % GRADIENT.length]}${chars[i]}`;
    }
    return result + RESET;
}

function sparkle(): string {
    return `${CYAN}${SPARKLES[Math.random() * SPARKLES.length | 0]}${RESET}`;
}

function addSparkles(text: string, density = 0.15): string {
    return text.split("\n").map(line => {
        if (line.trim() === "") return line;

        const chars = [...line];
        for (let i = 0; i < chars.length; i++) {
            if (chars[i] === " " && Math.random() < density) {
                chars[i] = sparkle();
            }
        }

        return `${sparkle()} ${chars.join("")} ${sparkle()}`;
    }).join("\n");
}

const box = (text: string): string => {
    const boxWidth = Math.min(70, getConsoleWidth() - 4);
    const horizontal = "═".repeat(boxWidth);
    const textPadding = (boxWidth - text.length) / 2 | 0;
    const leftPad = " ".repeat(textPadding);
    const rightPad = " ".repeat(boxWidth - text.length - textPadding);
    return `╔${horizontal}╗
║${leftPad}${text}${rightPad}║
╚${horizontal}╝`;
};

const ascii = String.raw`
     __  __  ___  ____  _  _  ____  ____               
    (  )(  )/ __)( ___)( \( )( ___)(_  _)              
     )(__)( \__ \ )__)  )  (  )__)   )(                
    (______)(___/(____)(_)\_)(____) (__)               
     ___  ____  ____  ____    __    __  __  ____  ____ 
    / __)(_  _)(  _ \( ___)  /__\  (  \/  )( ___)(  _ \
    \__ \  )(   )   / )__)  /(__)\  )    (  )__)  )   /
    (___/ (__) (_)\_)(____)(__)(__)(_/\/\_)(____)(_)\_)
`;

const tagline = `
  ${DIM}Developed by:${RESET} ${YELLOW}${BOLD}mkcfdc${RESET} ${DIM}│${RESET} ${BLUE}${UNDERLINE}https://github.com/mkcfdc/usenetstreamer${RESET}
  ${DIM}Original by:${RESET}  ${YELLOW}${BOLD}Sanket9225${RESET} ${DIM}│${RESET} ${BLUE}${UNDERLINE}https://github.com/Sanket9225/UsenetStreamer${RESET}
`;

// ═══════════════════════════════════════════════════════════════════
// SYNCHRONOUS banner - prints immediately, no race conditions
// ═══════════════════════════════════════════════════════════════════

function showBanner(): void {
    console.clear();

    // ASCII art with gradient + sparkles
    const decoratedAscii = addSparkles(applyGradient(ascii), 0.08);
    console.log(center(decoratedAscii));

    // Slogan box
    const slogan = "⚡ STREAM USENET CONTENT DIRECTLY TO STREMIO! ⚡";
    console.log(center(applyHorizontalGradient(box(slogan))));

    // Credits
    console.log(center(tagline));

    // Footer with sparkles
    const footerLine = `${sparkle()} ${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET} ${sparkle()}`;
    console.log(center(footerLine));
    console.log(center(`${DIM}Starting server...${RESET}`));
    console.log("\n");
}

// Run IMMEDIATELY and SYNCHRONOUSLY
showBanner();

// Export for manual use if needed
export { showBanner };
