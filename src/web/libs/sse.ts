export type SseFrame = {name?: string; data?: string};

// Kestra names SSE frames with "id", not the standard "event".
export function parseSseFrame(frame: string): SseFrame | null {
    let event: string | undefined;
    let id: string | undefined;
    const dataLines: string[] = [];

    for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) {
            event = line.substring("event:".length).trim();
        } else if (line.startsWith("id:")) {
            id = line.substring("id:".length).trim();
        } else if (line.startsWith("data:")) {
            dataLines.push(line.substring("data:".length).trim());
        }
    }

    const name = event ?? id;
    if (!name && dataLines.length === 0) {
        return null;
    }
    return {name, data: dataLines.join("\n")};
}

export async function readSseStream(reader: ReadableStreamDefaultReader<Uint8Array>, onFrame: (frame: SseFrame) => void) {
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const {done, value} = await reader.read();
        if (done) {
            break;
        }

        buffer += decoder.decode(value, {stream: true});
        // Frames end at a blank line, the trailing partial stays in the buffer.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
            const parsed = parseSseFrame(frame);
            if (parsed) {
                onFrame(parsed);
            }
        }
    }
}
