import { LineCounter, parseDocument, YAMLMap, visit, isMap, isScalar, Range } from "yaml";


export class YamlUtils {
  static extractAllTypes(source: string): { type: string, range: number[] }[] {
    const yamlDoc = parseDocument(source);
    const types: { type: string, range: number[] }[] = [];
    const contents = yamlDoc.contents as YAMLMap;
    if (contents && contents.items && contents.items.find((e: any) => ["tasks", "triggers", "errors"].includes(e.key?.value))) {
      visit(yamlDoc, (_, node) => {
        if (isMap(node)) {
          for (const item of node.items as any[]) {
            if (item.key?.value === "type") {
              types.push({type: (item.value as string), range: (node.range as Range)});
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

  static isFlow(source: string): boolean {
    try {
      const doc = parseDocument(source);
      return Boolean(doc.get("id") && doc.get("namespace") && (doc.get("tasks") || doc.get("triggers")));
    } catch {
      return false;
    }
  }

  static nodeRange(source: string, path: Array<string | number>): [number, number] | undefined {
    if (path.length === 0) {
      return undefined;
    }
    try {
      const node = parseDocument(source).getIn(path, true) as { range?: [number, number, number] } | undefined;
      return node?.range ? [node.range[0], node.range[1]] : undefined;
    } catch {
      return undefined;
    }
  }

  static inputIds(source: string): string[] {
    const inputs = this.toObject(source)?.inputs;
    return Array.isArray(inputs)
      ? inputs.map(input => (input as { id?: string })?.id).filter((id): id is string => Boolean(id))
      : [];
  }

  static taskIds(source: string): string[] {
    const root = this.toObject(source);
    const ids: string[] = [];
    const walk = (tasks: unknown) => {
      if (!Array.isArray(tasks)) {
        return;
      }
      for (const task of tasks) {
        if (task && typeof task === "object") {
          const t = task as { id?: string; tasks?: unknown; errors?: unknown; finally?: unknown };
          if (t.id) {
            ids.push(t.id);
          }
          walk(t.tasks);
          walk(t.errors);
          walk(t.finally);
        }
      }
    };
    walk(root?.tasks);
    walk(root?.errors);
    walk(root?.finally);
    return ids;
  }

  // Character range of the map whose "id" equals taskId, for click-to-reveal navigation.
  static taskRangeById(source: string, taskId: string): [number, number] | undefined {
    try {
      let range: [number, number] | undefined;
      visit(parseDocument(source), {
        Map(_key, node: YAMLMap) {
          const hasId = node.items.some(item =>
            isScalar(item.key) && item.key.value === "id" &&
            isScalar(item.value) && item.value.value === taskId);
          if (hasId && node.range) {
            range = [node.range[0], node.range[1]];
            return visit.BREAK;
          }
        }
      });
      return range;
    } catch {
      return undefined;
    }
  }

  static sectionKeys(source: string, section: string): string[] {
    const value = this.toObject(source)?.[section];
    return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
  }

  static toObject(source: string): Record<string, unknown> | null {
    try {
      return parseDocument(source).toJS() as Record<string, unknown> | null;
    } catch {
      return null;
    }
  }
}

export default YamlUtils;