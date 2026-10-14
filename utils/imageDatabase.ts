import { AIProviderType, ProviderSettings } from '../services/aiProvider';
import { archiveSourceFile, mediaChanged } from '../services/mediaSync';
import { deleteBankItems, hasBankToken, loadBankIndex } from '../services/bankService';
import {
  clearSavedLibraryImages,
  getSavedLibraryImageRecord,
  getGeneratedLibraryImageStats,
  getSavedLibraryImageStats,
  listSavedLibraryImages,
  removeSavedLibraryImage,
  type SingleUserSavedImage,
} from './singleUserMediaStore';
import { readJsonStorage, writeJsonStorage } from './singleUserStore';

export interface StoredImage extends SingleUserSavedImage {}

const PROVIDER_SETTINGS_STORAGE_KEY = 'providerSettings';
let cachedImages: StoredImage[] = [];

export class ImageDatabase {
  static async getAll(): Promise<StoredImage[]> {
    try {
      cachedImages = await listSavedLibraryImages();
      return cachedImages;
    } catch (error) {
      console.error('Error reading image database:', error);
      return [];
    }
  }

  static getByCategory(category: 'reference' | 'style' | 'asset'): StoredImage[] {
    return cachedImages.filter((img) => img.category === category);
  }

  static async getByCategoryAsync(category: 'reference' | 'style' | 'asset'): Promise<StoredImage[]> {
    const all = await this.getAll();
    return all.filter((img) => img.category === category);
  }

  static async add(file: File, _dataUrl: string, category: 'reference' | 'style' | 'asset'): Promise<StoredImage> {
    return archiveSourceFile(file, category);
  }

  static async remove(id: string): Promise<void> {
    const existing = await getSavedLibraryImageRecord(id);
    if (hasBankToken()) {
      const index = await loadBankIndex();
      const items = index.items.filter((item) => (Boolean(existing?.contentHash) && item.contentHash === existing?.contentHash) || `r2:${item.itemKey}` === existing?.remoteStoragePath);
      await deleteBankItems(items.map((item) => item.id));
    } else if (existing?.remoteStoragePath?.startsWith('r2:')) {
      throw new Error('Pro smazání z R2 odemkni knihovnu.');
    }
    await removeSavedLibraryImage(id);
    cachedImages = cachedImages.filter((image) => image.id !== id);
    mediaChanged();
  }

  static async clear(): Promise<void> {
    const all = await this.getAll();
    for (const image of all) await this.remove(image.id);
    await clearSavedLibraryImages();
    cachedImages = [];
  }

  static async clearByCategory(category: 'reference' | 'style' | 'asset'): Promise<void> {
    const all = await this.getAll();
    const toDelete = all.filter((image) => image.category === category);
    await Promise.all(toDelete.map((image) => this.remove(image.id)));
  }

  static async getSize(): Promise<number> {
    const stats = await getSavedLibraryImageStats();
    return stats.totalBytes / (1024 * 1024);
  }

  static async getCount(): Promise<number> {
    const stats = await getSavedLibraryImageStats();
    return stats.count;
  }

  static async getStorageStats(): Promise<{
    savedCount: number;
    generatedCount: number;
    totalBytes: number;
    usageBytes?: number;
    quotaBytes?: number;
  }> {
    const [savedStats, generatedStats, estimate] = await Promise.all([
      getSavedLibraryImageStats(),
      getGeneratedLibraryImageStats(),
      typeof navigator !== 'undefined' && navigator.storage?.estimate
        ? navigator.storage.estimate()
        : Promise.resolve(undefined),
    ]);

    return {
      savedCount: savedStats.count,
      generatedCount: generatedStats.count,
      totalBytes: savedStats.totalBytes + generatedStats.totalBytes,
      usageBytes: estimate?.usage,
      quotaBytes: estimate?.quota,
    };
  }
}

export class SettingsDatabase {
  private static sanitizeProviderSettings(settings: ProviderSettings): Record<string, any> {
    const sanitized: Record<string, any> = {};

    for (const provider of Object.values(AIProviderType)) {
      const config = settings[provider];
      sanitized[provider] = {
        enabled: Boolean(config?.enabled || config?.apiKey),
      };
    }


    if (settings.a1111) {
      sanitized.a1111 = {
        enabled: Boolean(settings.a1111.enabled || settings.a1111.baseUrl),
        baseUrl: settings.a1111.baseUrl || '',
        sdxlVae: settings.a1111.sdxlVae || '',
      };
    }

    return sanitized;
  }

  static async saveProviderSettings(settings: ProviderSettings): Promise<void> {
    writeJsonStorage(PROVIDER_SETTINGS_STORAGE_KEY, {
      ...settings,
      __singleUserSavedAt: new Date().toISOString(),
    });
  }

  static async loadProviderSettings(): Promise<ProviderSettings | null> {
    const data = readJsonStorage<Record<string, any> | null>(PROVIDER_SETTINGS_STORAGE_KEY, null);
    if (!data) return null;

    const restored: ProviderSettings = {};

    for (const provider of Object.values(AIProviderType)) {
      const entry = data?.[provider];
      if (!entry || typeof entry !== 'object') continue;
      restored[provider] = {
        apiKey: String((entry as any).apiKey || ''),
        enabled: Boolean((entry as any).enabled),
      };
    }


    if (data?.a1111) {
      restored.a1111 = {
        baseUrl: String(data.a1111.baseUrl || ''),
        sdxlVae: String(data.a1111.sdxlVae || ''),
        enabled: Boolean(data.a1111.enabled),
      };
    }

    if (data?.headSwap && typeof data.headSwap === 'object') {
      restored.headSwap = {
        preferredPrimary: 'openrouter',
        hairSource: data.headSwap.hairSource === 'user' ? 'user' : 'target',
        sourceGender: ['default', 'a man', 'a woman', 'nonbinary person'].includes(String(data.headSwap.sourceGender))
          ? data.headSwap.sourceGender
          : 'default',
        secondarySourceGender: ['default', 'a man', 'a woman', 'nonbinary person'].includes(String(data.headSwap.secondarySourceGender))
          ? data.headSwap.secondarySourceGender
          : 'default',
        useUpscale: Boolean(data.headSwap.useUpscale ?? true),
        useDetailer: Boolean(data.headSwap.useDetailer ?? false),
        facefusionEndpoint: String(data.headSwap.facefusionEndpoint || ''),
        refaceEndpoint: String(data.headSwap.refaceEndpoint || ''),
      };
    }

    const sanitized = this.sanitizeProviderSettings(restored);
    return {
      ...restored,
      ...Object.fromEntries(
        Object.entries(sanitized).map(([provider, value]) => [
          provider,
          {
            ...(restored as any)[provider],
            enabled: Boolean((value as any).enabled),
          },
        ])
      ),
    };
  }
}
