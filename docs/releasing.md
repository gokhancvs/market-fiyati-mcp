# Sürüm hazırlama

**Önce yeni sürüm numarasını seçin.** Bu rehber kaynak depo klonu içindir;
npm paketi geliştirme/test dosyalarını içermez.

Tek geliştirme dalı `main`; sürümler `v1.0.0` biçiminde tag + GitHub Releases ile izlenir.
Tag yeni dal değildir. Patch = düzeltme, minor = geriye uyumlu özellik, major = uyumsuz sözleşme.
Yayımlanan tag taşınmaz; değişiklik yeni sürüm alır.

## 1. Sürümü ve kontrolleri hazırlayın

1. `npm version <sürüm> --no-git-tag-version` çalıştırın; paket ve lockfile birlikte güncellenir.
   `src/server.ts` kimliğini aynı sürüme getirin. Zaten eşitse atlayın.
2. README'deki sabit `npx` sürümünü, CHANGELOG'u ve `docs/releases/v<sürüm>.md` notunu güncelleyin.
   Notta özellik, kurulum, doğrulama kapsamı ve bilinen sınırlar yer alsın; gerçekleşmeyen canlı başarı yazmayın.
3. `MARKET_FIYATI_MODE=offline npm run check` çalıştırın.
4. Conventional Commit oluşturup `main`'i push'layın.

**Beklenen:** Kontroller geçer; sürüm alanları ve notları aynı sürümü gösterir.

## 2. Tag ve GitHub release

Aşağıdaki `1.0.1` örneğini hedef sürümle değiştirin:

```sh
git tag -a v1.0.1 -m "Release v1.0.1"
npm run release:check -- v1.0.1
git push origin v1.0.1
gh workflow run release.yml --ref main -f tag=v1.0.1
```

GitHub arayüzü: **Actions → Publish release → Run workflow**, dal `main`, tag `v1.0.1`.
Yerel RTK kuralı varsa komutların başına `rtk` ekleyin.

- Tag, workflow'un test ettiği commit ile **birebir aynı** olmalıdır. Arada `main`'e yeni commit göndermeyin.
- Workflow yalnız `main`'de çalışır; bütün kontroller geçince release'i doğrudan yayımlar.
- Mevcut release/tag değiştirilmez; aynı sürümü yeniden oluşturmak hatadır.
- Workflow'u çalıştırmadan önce hedef tag'i ve sürüm notlarını doğrulayın; başarılı çalışma hemen yayımlar.
- Kararlı sürüm pre-release değildir. GitHub ZIP/TAR kaynak arşividir; derlenmiş npm paketi değildir.

## 3. npm arşivini doğrulayın

Paket adı `market-fiyati-mcp`. npm'den kaldırılan `1.0.0` tekrar kullanılamaz;
bu deponun npm hazırlığı `1.0.1` ile başlar. GitHub release'i npm yayını başlatmaz.

1. `npm pack` çalıştırın. `prepack` derlemeyi yeniler; arşiv yalnız çalışma JavaScript'i,
   seçili belgeler ve npm'in zorunlu dosyalarını içerir. Test/yerel arşiv/geliştirme betikleri dışarıda kalır.
2. Ayrı dizinde kurun: `npm install /mutlak/yol/market-fiyati-mcp-1.0.1.tgz --ignore-scripts`.
   npm bağımlılıkları indirilebilir; Market Fiyatı doğrulaması offline kalır.
3. Kurulu CLI'da `--help`, MCP bağlantısı ve `market_status` sonucunu kontrol edin.
4. Aynı arşivle prova yapın:

   ```sh
   npm publish /mutlak/yol/market-fiyati-mcp-1.0.1.tgz --dry-run --access public
   ```

**Beklenen:** Kurulu sunucu offline yanıt verir; arşiv içeriği doğru görünür.
Dry-run hesap yetkisini/sürüm uygunluğunu kanıtlamaz.
Otomatik paket testi arşivi açar ve bu CLI/MCP kontrollerini bağımlılık indirmeden yapar.

## 4. Yayımlayın

Yalnız gerçek yayın istendiğinde, doğrulanan arşivi gönderin:

```sh
npm publish /mutlak/yol/market-fiyati-mcp-1.0.1.tgz --access public
npm view market-fiyati-mcp@1.0.1 version dist.integrity
```

npm'in hesap doğrulamasını tamamlayın. **Başarı işareti:** Registry sürümü ve integrity
incelenen arşivle eşleşir. Token/tek kullanımlık kodları depoya kaydetmeyin.
Kaldırılsa bile aynı paket/sürüm çifti yeniden kullanılamaz.

## Bakım ve iş takibi

| İş                                  | Kural                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Her `main` push'u                   | Platform matrisi + bağımlılık denetimi; aynı workflow/dalda eski push/PR kontrolleri iptal edilebilir |
| Manuel release                      | Eski push/PR iptal grubundan ayrı                                                                     |
| Pazartesi 07:00 UTC / 10:00 Türkiye | Yalnız üretim bağımlılığı denetimi; GitHub zamanlaması gecikebilir                                    |
| `npm audit --omit=dev`              | Geliştirme bağımlılıklarını kapsamaz; sürümleri elle güncelleyip lockfile ile doğrulayın              |
| Issues                              | Hata/özellik formu, `bug`/`enhancement`/`documentation`, hedef milestone; ilk milestone `v1.0.0`      |

Tek dal tercihi nedeniyle otomatik Dependabot PR'ları yoktur.
Token, kişisel koordinat ve ham tanılamayı issue'ya eklemeyin.
