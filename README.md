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

Gereksinim: Node.js 18+ ve npm erişimi (Ruflo `npx` ile indirilir).
Superpowers ayrı bir plugin'dir, birlikte kurulmalıdır.

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
| `RUFLO_VERSION` | `3.71.0` | Kullanılacak `@claude-flow/cli` sürümü (sabitlenmiş) |
| `RUFLO_MEMORY_TOOLS` | 6 bellek aracı | Virgülle ayrılmış izinli araç listesi |

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
