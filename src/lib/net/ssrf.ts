// Защита от запросов во внутреннюю сеть (SSRF).
// Два слоя: проверка адреса до запроса и проверка IP в момент соединения (от подмены DNS).
import ipaddr from "ipaddr.js";

export class UnsafeUrlError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "UnsafeUrlError";
  }
}

/** Публичный ли это IP. Всё, что не обычный глобальный адрес, считается закрытым. */
export function isPublicIp(ip: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return false;
  }
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    // ::ffff:10.0.0.1 - это IPv4 в обёртке, проверяем вложенный адрес.
    if (v6.isIPv4MappedAddress()) return v6.toIPv4Address().range() === "unicast";
  }
  return addr.range() === "unicast";
}

const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet"];

/** Проверяет форму ссылки: схема, порт, имя узла. DNS здесь не трогаем. */
export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Это не похоже на ссылку");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Поддерживаются только ссылки http и https");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("Ссылки с логином и паролем не принимаются");
  }
  if (url.port !== "") {
    throw new UnsafeUrlError("Нестандартный порт в ссылке не поддерживается");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!host) throw new UnsafeUrlError("В ссылке нет адреса сайта");

  if (ipaddr.isValid(host)) {
    if (!isPublicIp(host)) throw new UnsafeUrlError("Эту ссылку проверить нельзя: она ведёт не на открытый сайт");
    return url;
  }
  // 127.1, 0x7f.1, 2130706433 - URL-парсер уже привёл бы их к IPv4. Остальное - имена.
  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s)) || !host.includes(".")) {
    throw new UnsafeUrlError("Эту ссылку проверить нельзя: она ведёт не на открытый сайт");
  }
  return url;
}

export type LookupAddress = { address: string; family: number };

/** Из ответа DNS оставляет адреса только если все они публичные. */
export function assertPublicAddresses(host: string, addresses: LookupAddress[]): LookupAddress[] {
  if (addresses.length === 0) throw new UnsafeUrlError(`Сайт ${host} не найден`);
  if (!addresses.every((a) => isPublicIp(a.address))) {
    throw new UnsafeUrlError("Эту ссылку проверить нельзя: она ведёт не на открытый сайт");
  }
  return addresses;
}
