# Sürüm hazırlama

Tek geliştirme dalı `main`'dir. Sürümler `v1.0.0` biçimindeki Git tag'leri ve
GitHub Releases ile izlenir; tag yeni bir dal oluşturmaz. Hata düzeltmelerinde
patch, geriye uyumlu özelliklerde minor, uyumsuz sözleşme değişikliklerinde major
sürümü artırın. Yayımlanan tag'leri taşımayın; düzeltmeler için yeni sürüm çıkarın.

## Tag ve taslak release

1. `main` üzerinde `npm version <sürüm> --no-git-tag-version` ile `package.json`
   ve lockfile sürümlerini birlikte güncelleyin. `src/server.ts` içindeki MCP sunucu
   kimliğinin sürümünü de eşitleyin. Zaten aynı sürümdeyse bu adımı atlayın.
2. `docs/releases/v<sürüm>.md` dosyasına özellikleri, kurulum bilgilerini,
   doğrulama kapsamını ve bilinen sınırlamaları yazın. Gerçekleşmeyen canlı
   doğrulamayı başarılı göstermeyin.
3. `MARKET_FIYATI_MODE=offline npm run check` çalıştırın; değişiklikleri
   Conventional Commits biçiminde commit edin ve `main` dalını push'layın.
4. Test edilen commit üzerinde açıklamalı tag oluşturup doğrulayın ve gönderin:

   ```sh
   git tag -a v1.0.0 -m "Release v1.0.0"
   npm run release:check -- v1.0.0
   git push origin v1.0.0
   ```

5. GitHub Actions'tan **Draft release → Run workflow** seçin. Dal `main`,
   `tag` girdisi `v1.0.0` olmalıdır. CLI karşılığı:

   ```sh
   gh workflow run release.yml --ref main -f tag=v1.0.0
   ```

Örnek sürümü yeni sürümle değiştirin. Tag oluşturma ile workflow başlatma arasında
`main`'e yeni commit göndermeyin: tag'in workflow'un test ettiği commit ile birebir
aynı olması zorunludur. Kontrollerin tamamı geçince otomasyon taslak oluşturur.
Mevcut release'i güncellemez veya tag'i taşımaz; aynı sürüm için yeniden oluşturma
hata verir. Workflow yalnız `main` üzerinden çalışır.

Taslağı GitHub Releases sayfasından gözden geçirip **Publish release** ile
yayımlayın. Otomasyon kendiliğinden yayımlamaz. Kararlı sürümlerde pre-release
seçeneği kapalı olmalıdır. GitHub kaynak ZIP/TAR arşivlerini sağlar; bunlar hazır
derlenmiş paket değildir. `private: true` npm yayımını engellemeye devam eder.

## Bakım ve iş takibi

Her `main` push'unda mevcut platform matrisi ve bağımlılık denetimi çalışır.
Aynı workflow/dal için eski push/PR kontrolleri iptal edilebilir; manuel release
kontrolleri bu iptal grubundan ayrıdır. Pazartesi 07:00 UTC (Türkiye saatiyle
10:00) zamanlaması yalnız üretim bağımlılığı denetimini çalıştırır; GitHub'ın
zamanlanmış işleri gecikebilir. `npm audit --omit=dev` geliştirme bağımlılıklarını
kapsamaz. Güncellemeleri elle uygulayıp lockfile ile birlikte doğrulayın.

Issues içindeki hata/özellik formlarını ve `bug`, `enhancement`, `documentation`
etiketlerini kullanın. İşi hedef sürüm milestone'una bağlayın; ilk milestone
`v1.0.0`'dır. Token, kişisel koordinat veya ham tanılama verisi issue'ya eklemeyin.
Tek dal tercihi nedeniyle otomatik Dependabot PR'ları yapılandırılmaz.
