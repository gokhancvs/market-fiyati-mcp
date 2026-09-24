# Değişiklik günlüğü

Kullanıcıları ve geliştiricileri etkileyen değişiklikler burada izlenir.
En yeni kayıt üsttedir; henüz bir sürüm tag'ine dâhil olmayan değişiklikler
**Yayımlanmamış** bölümünde tutulur.

## Yayımlanmamış

### Değişenler

- README, üç adımlı kurulum ve bağlantı akışı, tahmini süreler ve başarı işaretleriyle yeniden düzenlendi.
- Araç seçimi ve sonuçları yorumlama özeti öne alındı; teknik ayrıntılar, kullanım izinleri ve lisans dört açılır bölümde korundu.

### Eklenenler

- Sürüm değişikliklerini izlemek için bu değişiklik günlüğü eklendi.

## 1.0.0 — 2026-09-24

İlk sürüm tag'i: `v1.0.0`. Ayrıntılar: [sürüm notları](docs/releases/v1.0.0.md).

### Eklenenler

- Ürün arama, kategori keşfi, şube fiyatları, fiyat geçmişi ve sepet karşılaştırması için 15 araç, 3 kaynak ve 3 istem şablonu.
- Her çağrıda açık konum/şube bağlamı, API facet filtreleri, sınırlı sayfalama ve TRY/kuruş bazında karşılaştırma.
- Kaynak uyarılarının korunması, istek ölçümleri, şube kapsamı, istek bütçesi, iptal ve kaynak kullanım sınırları.
- Varsayılan offline mod, ağ erişimini engelleyen sentetik testler ve istemciden bağımsız kabul kiti.
- CI kontrolleri, doğrulanmış tag üzerinden taslak sürüm hazırlama ve GitHub issue şablonları.

Sentetik testler uzak API davranışının doğrulandığı anlamına gelmez.
Doğrulama kapsamı ve sınırları [doğrulama belgesinde](docs/verification.md) açıklanır.
