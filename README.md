# superpowers-ruflo-bridge

Superpowers + Ruflo birlikte, çakışmadan:

| Katman | Kim yapar |
|---|---|
| Brainstorm, plan, TDD, subagent, paralel agent, worktree, code review | **Superpowers** |
| Oturumlar ve subagent'lar arası kalıcı, aranabilir bellek | **Ruflo** (yalnızca bellek) |

Ruflo MCP sunucusu 385 araç açar (swarm, hive-mind, agent, hooks, claims…).
Bu plugin Ruflo'yu arka planda çalıştıran küçük bir proxy içerir ve Claude'a
**yalnızca 6 bellek aracını** gösterir:

`memory_store` · `memory_search` · `memory_retrieve` · `memory_list` · `memory_delete` · `memory_stats`

Diğer tüm araçlar listede görünmez; çağrılırsa reddedilir. `npx ruflo init`
gerekmez; Ruflo hook'ları, agent'ları ve CLAUDE.md eklemeleri projeye girmez.

## İçerik

```
.claude-plugin/marketplace.json        marketplace (bu repo)
plugins/ruflo-memory/
  .claude-plugin/plugin.json
  .mcp.json                            ruflo-memory MCP kaydı
  mcp/ruflo-memory-proxy.mjs           bağımlılıksız filtreleyici proxy
  skills/memory-bridge/SKILL.md        Superpowers akışına bellek adımları
examples/
  project-settings.json                bulut / ekip için .claude/settings.json
  gitignore-additions
```

## Kurulum

Gereksinim: Node.js 18+ ve npm erişimi. Ruflo'yu ayrıca kurmanız gerekmez;
ilk açılışta `npx` ile otomatik indirilir. Superpowers ayrı bir plugin'dir,
birlikte kurulmalıdır.

**İlk açılış:** Proxy Claude Code'a anında bağlanır (araç şemaları sabit),
Ruflo'yu arka planda başlatır. İlk kez indirilirken bu yaklaşık 1 dakika
sürer; bu sürede gelen bellek çağrıları sıraya alınır ve Ruflo hazır olunca
cevaplanır. Sonraki açılışlar npm önbelleğinden gelir.

İsteğe bağlı olarak Ruflo'yu önceden kurarsanız proxy onu kullanır ve
indirme beklemesi olmaz:

```
npm install -g @claude-flow/cli@3.71.0
```

### Yerel terminal

```
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
/plugin marketplace add ozdemirumit/superpowers-ruflo-bridge
/plugin install ruflo-memory@superpowers-ruflo-bridge
```

### Claude Code on the web (bulut oturumu)

`examples/project-settings.json` içeriğini projenin `.claude/settings.json`
dosyasına ekleyip commit edin. Bulut ortamının GitHub ve npm'e ağ erişimi
olmalı. Plugin'ler ilk bulut oturumunda yüklenmeyebilir; öyleyse yeni bir
oturum açın.

### Proje `.gitignore`

Ruflo belleği proje kökünde `.swarm/` ve `.claude-flow/` altında tutulur.
Bunları `.gitignore`'a ekleyin (`examples/gitignore-additions`).

## Ayarlar (ortam değişkenleri)

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `RUFLO_VERSION` | `3.71.0` | `npx` ile indirilecek `@claude-flow/cli` sürümü (sabitlenmiş) |
| `RUFLO_CMD` | — | Ruflo çalıştırılabilir dosyasının yolu; verilirse `npx` kullanılmaz |
| `RUFLO_MEMORY_TOOLS` | 6 bellek aracı | Virgülle ayrılmış, 6 araçtan seçilmiş alt küme |
| `RUFLO_STARTUP_TIMEOUT_MS` | `300000` | Ruflo'nun açılması için beklenecek en uzun süre |

Öncelik sırası: `RUFLO_CMD` → PATH'teki `claude-flow` → `npx`.

## Sorun giderme

**MCP sunucusu bağlanamadı / zaman aşımı (0.1.0):** İlk sürüm Ruflo
inene kadar bağlantıyı bekletiyordu ve ilk açılışta 30 saniyelik sınırı
aşıyordu. 0.2.0 ile düzeltildi; plugin'i güncelleyin.

**`policy-anchor-log-missing` veya `policy-ledger-truncated`:** Ruflo,
her proje için proje dışında (`~/.config/ruflo/policy-trust/`) bir
kurcalama-koruma kaydı tutar. Projedeki `.claude-flow/` klasörü silinir
veya sıfırlanırsa (ör. `git clean -fdx`) Ruflo tüm çağrıları reddeder.
Proje kökünde şunu çalıştırın:

```
node ~/.claude/plugins/cache/superpowers-ruflo-bridge/ruflo-memory/<sürüm>/mcp/reset-ruflo-trust.mjs
```

Script yalnızca bu projenin kaydını ve `.claude-flow/policy` klasörünü
siler; `.swarm/` içindeki anılar korunur. Sonra yeni bir oturum açın.
Bu yüzden `git clean -fdx` kullanıyorsanız `-e .claude-flow -e .swarm`
ekleyin.

## Anlamsal arama notu

Ruflo, gerçek anlamsal arama için `Xenova/all-MiniLM-L6-v2` modelini
Hugging Face'ten indirir. `huggingface.co` erişimi yoksa (ör. kısıtlı bulut
ağı) Ruflo "mock vectors" moduna düşer: kayıt/okuma çalışır ama arama
anlam yerine zayıf metin eşleşmesiyle yapılır. `memory_stats` çıktısındaki
`embeddingCoverage` değeri `0.0%` ise bu durumdasınız.

## Neden swarm yok?

Superpowers zaten subagent'ları (sıralı ve paralel) yönetir. İki koordinatör
aynı oturumda çakışır. Swarm gerekiyorsa Ruflo'yu ayrı bir projede tam
kurulumla (`npx ruflo init`, Superpowers olmadan) kullanın.
