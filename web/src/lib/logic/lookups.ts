import type { Entity } from "@/lib/qbo/client";

export class LookupError extends Error {}

/** Case-insensitive lookup by full name, account number or short name; refuses ambiguous matches. */
export class NameIndex {
  byId = new Map<string, Entity>();
  private tables: Map<string, Entity[]>[] = [new Map(), new Map(), new Map()];

  constructor(public kind: string, public items: Entity[], fullKey: string, shortKey?: string, numberKey?: string) {
    for (const item of items) {
      this.byId.set(item.Id, item);
      this.add(0, item[fullKey], item);
      if (numberKey) this.add(1, item[numberKey], item);
      if (shortKey) this.add(2, item[shortKey], item);
    }
  }

  private add(t: number, key: unknown, item: Entity) {
    if (key === undefined || key === null || key === "") return;
    const k = String(key).trim().toLowerCase();
    const list = this.tables[t].get(k) ?? [];
    list.push(item);
    this.tables[t].set(k, list);
  }

  find(text: string): Entity | null {
    const key = text.trim().toLowerCase();
    if (!key) return null;
    if (key.startsWith("id:")) return this.byId.get(key.slice(3).trim()) ?? null;
    for (const table of this.tables) {
      const hits = table.get(key) ?? [];
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) {
        const names = hits.map((h) => `${h.FullyQualifiedName ?? h.DisplayName} (id ${h.Id})`).join(", ");
        throw new LookupError(`'${text}' matches more than one ${this.kind}: ${names}. Use the full name or id:<Id>.`);
      }
    }
    return null;
  }

  get(text: string): Entity {
    const found = this.find(text);
    if (!found) throw new LookupError(`No ${this.kind} named '${text}'.`);
    return found;
  }

  childrenOf(id: string, activeOnly = true): Entity[] {
    return this.items.filter((a) => a.ParentRef?.value === id && (a.Active !== false || !activeOnly));
  }
}

export const accountIndex = (accounts: Entity[]) => new NameIndex("account", accounts, "FullyQualifiedName", "Name", "AcctNum");
export const classIndex = (items: Entity[]) => new NameIndex("class", items, "FullyQualifiedName", "Name");
export const locationIndex = (items: Entity[]) => new NameIndex("location", items, "FullyQualifiedName", "Name");
export const customerIndex = (items: Entity[]) => new NameIndex("customer", items, "FullyQualifiedName", "DisplayName");
export const vendorIndex = (items: Entity[]) => new NameIndex("vendor", items, "DisplayName");
