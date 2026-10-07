# Market Fiyatı MCP

> **Resmî değildir.** Bu proje Market Fiyatı, TÜBİTAK veya market zincirleriyle bağlantılı değildir ve onlar tarafından onaylanmamıştır.
> Kullanım koşulları operatörün sorumluluğundadır: [Amaç ve kullanım izinleri](#amaç-ve-kullanım-izinleri).

**Başlayın:** Aşağıdaki yapılandırmayı MCP istemcinize ekleyin.

Türkiye'de ürün, şube fiyatı ve sepet karşılaştırması için MCP sunucusu.
**Node.js 22+ gerekir.** Normal kullanım gerçek fiyat sorguları için `live` modudur;
`offline` geliştirme ve test içindir. Aşağıdaki örnek, önceki sürümlerde de çalışması için modu açıkça seçer.

## 1. İstemciye ekleyin

**Şube keşfi:** Ürün aramaları şube ID'si ister; yakındaki şubeleri bulan tool deneysel erişim gerektirir.
Bu ayar yakın şube, market listesi, adres/koordinat arama, toplu ürün güncelleme ve alternatif ürün tool'larını açar.
Bu yüzden örnek `"MARKET_FIYATI_ENABLE_EXPERIMENTAL": "true"` içerir. Ayarın varsayılanı `false` olarak kalır;
şube ID'lerinizi zaten biliyorsanız bu satırı silebilirsiniz.

```json
{
  "mcpServers": {
    "market-fiyati": {
      "command": "npx",
      "args": ["-y", "market-fiyati-mcp@1.0.11"],
      "env": {
        "MARKET_FIYATI_MODE": "live",
        "MARKET_FIYATI_LATITUDE": "41.025591",
        "MARKET_FIYATI_LONGITUDE": "28.974075",
        "MARKET_FIYATI_DISTANCE": "4",
        "MARKET_FIYATI_ENABLE_EXPERIMENTAL": "true"
      }
    }
  }
}
```

**Örnek: Galata Kulesi — `41.025591, 28.974075`.**
`distance=4`, merkezden **4 km yarıçap** demektir (8 km çap).

**Sayı tipi:** Tool girdisindeki koordinat ve yarıçap tırnaksız JSON sayısıdır.
Yalnız `env` değerleri ortam değişkeni olduğu için tırnaklıdır; sunucu bunları sayıya çevirir.

`market_find_nearby_depots` için aynı örnek, tırnaksız sayılarla:

```json
{ "latitude": 41.025591, "longitude": 28.974075, "distance": 4 }
```

### Yapılandırma dosyası nerede?

Yukarıdaki `market-fiyati` girdisini istemcinizin dosyasına ekleyin ve istemciyi yeniden başlatın.

| İstemci        | Dosya                                                                                                                              | Not                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Claude Desktop | macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`<br>Windows: `%APPDATA%\Claude\claude_desktop_config.json` | `mcpServers` anahtarı                                    |
| Claude Code    | Proje: `.mcp.json` · Komut: `claude mcp add`                                                                                       | `mcpServers` anahtarı                                    |
| Cursor         | Genel: `~/.cursor/mcp.json` · Proje: `.cursor/mcp.json`                                                                            | `mcpServers` anahtarı                                    |
| VS Code        | Proje: `.vscode/mcp.json`                                                                                                          | Üst anahtar `servers`; girdiye `"type": "stdio"` ekleyin |
| Codex          | `~/.codex/config.toml`                                                                                                             | TOML: `[mcp_servers.market-fiyati]` ve `.env` tablosu    |

Kendi konumunuz için koordinatları değiştirin. Kişisel konumunuzu özel istemci ayarında tutun; Git'e eklemeyin.

Env konumu 1.0.6'dan beri desteklenir ([yarıçap geçişi](docs/api.md#106-yarıçap-geçişi)). Paket kurulamıyorsa [kaynak koddan çalıştırın](#kaynak-koddan-geliştirme).
`npx` paketi indirir; bulunamazsa mutlak yolunu kullanın. [Hazır Galata yapılandırması](examples/mcp-config.json).

## 2. Bağlantıyı doğrulayın

Sunucuyu yeniden başlatıp AI'ya şunu yazın:

> `market_status` çağır. Modu ve konum ayarının hazır olup olmadığını göster.

**Beklenen:** `data.mode=live`, `data.liveRequestsEnabled=true`, `data.locationDefaults.configured=true`.
Status yalnız ayarları kontrol eder; gerçek fiyat için sonraki adımdaki aramayı yapın.

## 3. Fiyat sorgulayın

AI'ya istediğiniz ürünü ve marketleri söyleyin. Konum ayarı hazırsa tekrar vermeniz gerekmez.
Şubeler bilinmiyorsa yukarıda açtığınız deneysel erişimle `market_find_nearby_depots` bir kez çağrılır;
ürün aramasında dönen şube ID'leri kullanılır. Adımlar: [Gerçek fiyatlarla sorgulama](docs/live-testing.md).

### Örnek istekler

> Yakınımdaki şubelerde 1 litre yarım yağlı sütün en ucuz fiyatı ne?

> 3 kg yoğurdu fiyata göre sırala; tam eşleşmeleri ve alternatifleri ayrı göster.

> 500 g beyaz peynirin fiyatını şubeler arasında karşılaştır ve harita linklerini ver.

> 1 kg patates, 2 L süt ve 10'lu yumurtadan oluşan sepeti şube bazında karşılaştır.

> 1 kg toz şekerin fiyat geçmişini özetle.

Ürün adlarını ve paket boyutlarını açık yazın. "Sadece tam eşleşme" gibi kesin şartları belirtin;
aksi hâlde AI benzer ürünleri ayrı başlıkta açıklayarak önerebilir.

## Konum nasıl çalışır?

| Durum                     | Kural                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| Env kullanıyorum          | Üç değeri birlikte ayarlayın; AI her sorguda tekrar sormaz.                                   |
| Env kullanmıyorum         | Üçünü de kaldırın; enlem, boylam ve yarıçapı her konumlu çağrıda sağlayın.                    |
| Başka konum arıyorum      | Enlem/boylamı birlikte verin. Distance yoksa env yarıçapı kullanılır.                         |
| Eksik veya geçersiz değer | Env hatalıysa sunucu başlamaz; çağrı hatalıysa o çağrı reddedilir. Varsayılan yarıçap yoktur. |
| Ayarı değiştirdim         | Env için yeniden başlatın. Çağrıdaki değişiklik yalnız o çağrıya aittir.                      |

Şubeler (`depots`) ürün çağrısında ayrıca gerekir; MCP bunları saklamaz.
Aynı süreç env konumunu paylaşır; farklı kullanıcılar ayrı süreç veya açık çağrı değerleri kullanmalıdır.
[Tüm konum kuralları ve sınırlar](docs/api.md#konum-ve-şube-bağlamı).

## Yapabilecekleriniz

| Amaç                         | Tool                            |
| ---------------------------- | ------------------------------- |
| Ürün ara                     | `market_search_products`        |
| Şube fiyatlarını karşılaştır | `market_compare_product_offers` |
| Sepet karşılaştır            | `market_compare_basket`         |
| Fiyat geçmişini incele       | `market_get_price_history`      |
| Çağrı akışını öğren          | `market://guide`                |

**15 tool · 3 resource · 3 prompt.** Satın alma, sipariş ve barkod sorgusu desteklenmez.

## Sonuçları doğru okuyun

- Fiyatlar **TRY**. `percentage` indirim oranı değildir; API'nin [`discount` işaretine](docs/api.md#discount-işaretini-okuma) bakın.
- Eksik offer **bilinmiyor** demektir; “stok yok” veya “tüm fiyatlar tarandı” denemez.
- Eksik sepette `total=null`; `subtotal` yalnız bulunan ürünlerdir.
- Fiziksel şube karşılaştırması için `groupBy=depot` kullanın; zincir tek bir şube değildir.
- Sepet en fazla **5 ürün** alır; bütçe retry dâhil 5 HTTP denemesidir. Retry açıksa ürün sınırı düşer
  (`market_status` içindeki `limits.basketItems`). Listeyi bölerek veya tool değiştirerek aşmayın.

## Sorun giderme

| Hata veya belirti                   | Neden ve çözüm                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NETWORK_DISABLED`                  | İstemci ayarında `MARKET_FIYATI_MODE=offline` vardır veya 1.0.7 ya da daha eski bir sürüm kuruludur. Değeri `live` yapıp sunucuyu yeniden başlatın. Değişkeni silmek yalnız 1.0.8 ve sonrasında yeterlidir. Ağsız geliştirme ortamında `offline` kalmalıdır.                                                                                                                                                                                                                                                                                                                                                         |
| `EXPERIMENTAL_DISABLED`             | Yakın şube, adres arama gibi deneysel tool'lar kapalıdır. Ayara `"MARKET_FIYATI_ENABLE_EXPERIMENTAL": "true"` ekleyip yeniden başlatın veya şube ID'lerini kendiniz verin.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `OUTPUT_TOO_LARGE`                  | Yanıt yerel boyut sınırını aştı; kısmi veri dönmez. Aynı sorguyu tekrarlamayın: sayfa boyutunu (`size`), şube veya sepet ürünü sayısını azaltın.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Sunucu listede görünmüyor (Windows) | Claude Desktop MSIX paketiyle kurulduysa (Microsoft Store, WinGet veya resmî kurucu) uygulamanın dosyayı `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json` yolundan okuduğu [bildiriliyor](https://github.com/anthropics/claude-code/issues/26073). Settings > Developer > "Edit Config" ise `%APPDATA%` altındaki dosyayı açabilir. `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc` klasörü varsa `mcpServers` girdisini bu dosyaya ekleyin ve uygulamayı tamamen kapatıp açın; klasör yoksa bu satır sizin için geçerli değildir. Bu yol resmî belgede yer almaz. |

Diğer hata kodları: [API](docs/api.md#diğer-hata-kodları).

## Kaynak koddan geliştirme

Depoyu klonlayıp çalıştırın:

```sh
npm ci --ignore-scripts
MARKET_FIYATI_MODE=offline npm run check
```

`check` derlemeyi de yapar. İstemcide `command: "node"`, `args` içinde `dist/src/index.js` dosyasının
mutlak yolunu kullanın. Geliştirirken istemci env ayarını açıkça `MARKET_FIYATI_MODE=offline` yapın;
testlerin ağ engeli de korunur. Gerekirse `node` yolunu da mutlak yazın.

Sunucu stdio JSON-RPC kullanır; HTTP portu açmaz. Geliştirmede `MARKET_FIYATI_MODE=offline npm start`
MCP mesajlarını bekler. Mod ayarı olmadan başlangıç `live` seçer; yalnız başlatmak HTTP isteği göndermez.
stdout yalnız MCP trafiğidir. npm kurulumu ağ kullanabilir; uygulama testleri API'ye bağlanmaz.

## Ayrıntı gerektiğinde

| İhtiyaç                         | Belge                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------- |
| Gerçek fiyatları sorgula        | [Gerçek fiyatlarla sorgulama](docs/live-testing.md)                              |
| Tool, filtre ve yanıt kuralları | [API](docs/api.md)                                                               |
| Ayarlar ve kod yapısı           | [Mimari](docs/architecture.md)                                                   |
| Testler ve sınırları            | [Doğrulama](docs/verification.md) · [Sentetik kabul](docs/offline-acceptance.md) |
| Sürüm çıkarma                   | [Yayın rehberi](docs/releasing.md) · [CHANGELOG](CHANGELOG.md)                   |

## Amaç ve kullanım izinleri

Bu proje, ticari kazanç veya başka bir çıkar gözetilmeden geliştirilmiş bağımsız bir çalışmadır.
Market Fiyatı'nın, TÜBİTAK'ın veya market zincirlerinin resmî ürünü değildir. Herhangi bir onay,
sponsorluk veya ortaklık iddiası yoktur.

[Market Fiyatı kullanım koşullarını](https://marketfiyati.org.tr/kullanim-kosullari) değerlendirmek ve
kullanımına uygun izinleri sağlamak operatörün sorumluluğundadır. Bu depo üçüncü taraf servislerine
erişim izni vermez; `live` ayarı yalnız teknik erişimi belirler.

Güvenlik açığı bildirmek için [özel bildirim yönergesini](SECURITY.md) kullanın.

## Lisans

[MIT](LICENSE) — Copyright (c) 2026 Gökhan Çavuş.

Lisans yalnızca yazılımı ve beraberindeki belgeleri kapsar. Üçüncü tarafların verilerine, markalarına,
logolarına veya servislerine erişim hakkı vermez. Yukarıdaki amaç beyanı MIT lisansını değiştirmez ve
koda ticari kullanım yasağı eklemez. Üçüncü taraf bileşenler kendi lisanslarına tabidir.
