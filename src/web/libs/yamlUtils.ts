import { LineCounter, parseDocument, YAMLMap, visit, Range } from "yaml";


export class YamlUtils {
  static extractAllTypes(source: string): { type: string, range: number[] }[] {
    const yamlDoc = parseDocument(source);
    const types: { type: string, range: number[] }[] = [];
    const contents = yamlDoc.contents as YAMLMap;
    if (contents && contents.items && contents.items.find((e: any) => ["tasks", "triggers", "errors"].includes(e.key?.value))) {
      visit(yamlDoc, {
        Map(_, map) {
            if (map.items) {
                for (const item of map.items) {
                    if (item.key == "type") {
                        const type = item.value;
                        types.push({type: (type as string), range: (map.range as Range)});
                    } 
                }
            }
        }
      });
    }
    return types;
  }

  static getTaskType(source: string, position: { lineNumber: number, column: number }): string | null {
    const types = this.extractAllTypes(source);

    const lineCounter = new LineCounter();
    parseDocument(source, { lineCounter });
    const cursorIndex = lineCounter.lineStarts[position.lineNumber - 1] + position.column;

    for (const type of types.reverse()) {
      if (cursorIndex > type.range[1]) {
        return type.type;
      }
      if (cursorIndex >= type.range[0] && cursorIndex <= type.range[1]) {
        return type.type;
      }
    }
    return null;
  }
}

export default YamlUtils;