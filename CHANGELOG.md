# Değişiklik günlüğü

En yeni değişiklikler en üsttedir. Henüz tag'lenmemiş değişiklikler **Yayımlanmamış** bölümündedir.

## Yayımlanmamış

Henüz değişiklik yok.

## 1.0.2 — 2026-09-24

Ayrıntılar için [sürüm notlarına](docs/releases/v1.0.2.md) bakın.

### Değişenler

- `main` geçmişindeki bir commit'e yeni bir kararlı sürüm tag'i push edildiğinde offline kontroller, npm'e
  OIDC ile yayın, integrity doğrulaması ve GitHub Release oluşturma otomatik olarak çalışır.
- Dokümanlar kısa adımlar ve tablolarla yeniden düzenlendi; README ile API belgesi arasındaki tekrarlar azaltıldı.
- Dokümanlar daha anlaşılır ve sade bir Türkçeyle yeniden yazıldı. Teknik terimler İngilizce bırakıldı.

## 1.0.1 — 2026-09-24

npm dağıtımı için hazırlanan sürüm. Bu kayıt, npm yayınının gerçekleştiğinin kanıtı değildir.

### Eklenenler

- Sürüm değişikliklerini izlemek için bu değişiklik günlüğü eklendi.
- `1.0.1` için npm yayın hazırlığı yapıldı: yalnızca seçili dosyaların paketlenmesi, paketlemeden önce
  derleme ve npm depo bilgileri.
- Dağıtım arşivinin geliştirme dosyalarını içermediğini ve offline MCP sunucusu olarak çalıştığını doğrulayan
  bir paket testi eklendi.
- Sürümü sabitlenmiş bir `npx` bağlantı örneği ve arşivden elle yayınlama adımları eklendi.

### Değişenler

- README üç adımlı kurulum ve bağlantı akışı, tahmini süreler ve başarı ölçütleriyle yeniden düzenlendi.
- Tool seçimi ve sonuçların nasıl okunacağı öne alındı. Teknik ayrıntılar, kullanım izinleri ve lisans dört
  açılır bölümde korundu.

## 1.0.0 — 2026-09-24

İlk Git sürümü: `v1.0.0`. Ayrıntılar için [sürüm notlarına](docs/releases/v1.0.0.md) bakın.

### Eklenenler

- Ürün arama, kategori keşfi, şube fiyatları, fiyat geçmişi ve sepet karşılaştırması için 15 tool, 3 resource
  ve 3 prompt.
- Her çağrıda açıkça verilen konum ve şube context'i, API facet filtreleri, sınırlı sayfalama ve TRY/kuruş
  bazında karşılaştırma.
- Upstream uyarılarının korunması, istek ölçümleri, şube kapsamı, istek bütçesi, iptal ve kaynak kullanım
  sınırları.
- Varsayılan offline mod, ağ erişimini engelleyen sentetik testler ve istemciden bağımsız bir kabul kiti.
- CI kontrolleri, doğrulanmış tag üzerinden taslak sürüm hazırlama ve GitHub issue şablonları.

Sentetik testlerin geçmesi, uzak API davranışının doğrulandığı anlamına gelmez. Doğrulama kapsamı ve sınırları
[doğrulama belgesinde](docs/verification.md) anlatılır.
