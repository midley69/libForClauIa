// Gestionnaire de cookies pour LiberTalk
export interface UserPreferences {
  pseudo: string;
  genre: 'homme' | 'femme' | 'autre';
  autoswitchEnabled: boolean;
  lastUsed: string;
}

class CookieManager {
  private static readonly COOKIE_NAME = 'libertalk_preferences';
  private static readonly COOKIE_EXPIRY_DAYS = 30;

  // Sauvegarder les préférences utilisateur
  static savePreferences(preferences: UserPreferences): void {
    try {
      const data = {
        ...preferences,
        lastUsed: new Date().toISOString()
      };
      
      const cookieValue = btoa(JSON.stringify(data)); // Encoder en base64
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + this.COOKIE_EXPIRY_DAYS);
      
      document.cookie = `${this.COOKIE_NAME}=${cookieValue}; expires=${expiryDate.toUTCString()}; path=/; SameSite=Strict`;
      
      console.log('✅ Préférences sauvegardées dans les cookies:', preferences);
    } catch (error) {
      console.error('❌ Erreur lors de la sauvegarde des préférences:', error);
    }
  }

  // Charger les préférences utilisateur
  static loadPreferences(): UserPreferences | null {
    try {
      const cookies = document.cookie.split(';');
      const targetCookie = cookies.find(cookie => 
        cookie.trim().startsWith(`${this.COOKIE_NAME}=`)
      );

      if (!targetCookie) {
        console.log('ℹ️ Aucune préférence trouvée dans les cookies');
        return null;
      }

      const cookieValue = targetCookie.split('=')[1];
      const decodedData = atob(cookieValue); // Décoder depuis base64
      const preferences = JSON.parse(decodedData) as UserPreferences;

      // Vérifier si les préférences ne sont pas trop anciennes (30 jours)
      const lastUsed = new Date(preferences.lastUsed);
      const now = new Date();
      const daysDiff = (now.getTime() - lastUsed.getTime()) / (1000 * 3600 * 24);

      if (daysDiff > this.COOKIE_EXPIRY_DAYS) {
        console.log('⚠️ Préférences expirées, suppression');
        this.clearPreferences();
        return null;
      }

      console.log('✅ Préférences chargées depuis les cookies:', preferences);
      return preferences;
    } catch (error) {
      console.error('❌ Erreur lors du chargement des préférences:', error);
      this.clearPreferences(); // Nettoyer en cas d'erreur
      return null;
    }
  }

  // Supprimer les préférences
  static clearPreferences(): void {
    try {
      document.cookie = `${this.COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
      console.log('✅ Préférences supprimées des cookies');
    } catch (error) {
      console.error('❌ Erreur lors de la suppression des préférences:', error);
    }
  }

  // Mettre à jour une préférence spécifique
  static updatePreference<K extends keyof UserPreferences>(
    key: K, 
    value: UserPreferences[K]
  ): void {
    const currentPreferences = this.loadPreferences();
    if (currentPreferences) {
      const updatedPreferences = {
        ...currentPreferences,
        [key]: value,
        lastUsed: new Date().toISOString()
      };
      this.savePreferences(updatedPreferences);
    }
  }

  // Synchroniser avec les paramètres du compte utilisateur
  static syncWithUserAccount(userSettings: Partial<UserPreferences>): UserPreferences {
    const cookiePreferences = this.loadPreferences();
    
    // Les paramètres du compte ont la priorité sur les cookies
    const syncedPreferences: UserPreferences = {
      pseudo: userSettings.pseudo || cookiePreferences?.pseudo || '',
      genre: userSettings.genre || cookiePreferences?.genre || 'autre',
      autoswitchEnabled: userSettings.autoswitchEnabled ?? cookiePreferences?.autoswitchEnabled ?? false,
      lastUsed: new Date().toISOString()
    };

    // Sauvegarder les préférences synchronisées
    this.savePreferences(syncedPreferences);
    
    console.log('🔄 Préférences synchronisées avec le compte utilisateur:', syncedPreferences);
    return syncedPreferences;
  }

  // Vérifier si l'utilisateur a des préférences sauvegardées
  static hasPreferences(): boolean {
    return this.loadPreferences() !== null;
  }

  // Obtenir une préférence spécifique
  static getPreference<K extends keyof UserPreferences>(key: K): UserPreferences[K] | null {
    const preferences = this.loadPreferences();
    return preferences ? preferences[key] : null;
  }
}

export default CookieManager;