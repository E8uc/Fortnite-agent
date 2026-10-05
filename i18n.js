(() => {
  "use strict";

  const STORAGE_KEY =
    "fortniteAiAgent.language.v1";

  const SUPPORTED =
    ["en", "fr", "ar"];

  const COPY = {
    en: {
      account: "Account",
      accountInfo: "Account Info",
      accountStatus: "Account Status",
      usage: "Usage",
      theme: "Theme",
      siteTheme: "Site Theme",
      systemTheme: "System Theme",
      currentTheme: "(Current)",
      edit: "Edit",
      profilePicture: "Profile Image",
      signOut: "Sign Out",
      accountLogin: "Log In",
      apiConnected: "Connected To OpenRouter",
      apiDisconnected: "Not Connected To OpenRouter",
      reConnect: "ReConnect",
      signOutPrompt: "Sign out from your account?",
      logInPrompt: "Log in to your account?",
      discordCommunity: "Join our Discord community for more Fortnite tools and more",
      joinNow: "Join Now",

      brand: "E8",
      newChat: "New chat",
      moreTools: "More Fortnite Tools",
      settings: "Settings",
      recents: "Recents",

      welcomeTitle:
        "Chat with E8 Helper",

      welcomeSubtitle:
        "Fortnite files, UEFN, asset paths.",

      messagePlaceholder:
        "Message E8 Helper",

      toolsTitle:
        "More Fortnite Tools",

      searchTab: "Search",
      ids: "IDs",
      devices: "Devices",
      convert: "Convert",
      path: "Path Modifier",
      cosmetic: "Cosmetics",

      settingsTitle: "Settings",
      changeLanguage:
        "Change the language",
      language: "Language",

      login: "Log in",
      createNew: "Create New",
      guest: "guest",

      accountFree:
        "Account for free or continue as a",

      accountSetup:
        "Account set up",

      choosePhoto:
        "Choose photo",

      username: "Username",
      save: "Save",

      changeUsername:
        "Change username",

      usernameHint:
        "Type Whatever u want — 9 characters max.",

      changeTheme:
        "Change The Theme",

      blackTheme:
        "Dark Theme",

      whiteTheme:
        "Light Theme",

      ownerAccounts:
        "Owner Accounts",

      manualSearch:
        "Manual Search",

      manualNote:
        "Search the Fortnite asset database without sending the query to the AI.",

      searchPlaceholder:
        "Search a path/assets..",

      search: "Search",
      searching: "Searching",

      all: "All",
      newAssets: "New",
      formatted: "Formatted",

      description:
        "Description",

      preview:
        "Preview",

      hidePreview:
        "Hide Preview",

      references:
        "References",

      noReferences:
        "No verified references were returned.",

      cooldownLeft:
        "{seconds} sec left",

      pathModifier:
        "Path Modifier",

      pathNote:
        "Convert Fortnite filesystem paths to mountaware Unreal object paths.",

      format: "Format",
      addClassAction: "Add _C",
      addClass: "Add _C",

      classSkipped:
        "_C skipped: this asset does not look class compatible.",

      convertedPath:
        "Converted path will appear here",

      copy: "Copy",
      copied: "Copied",

      json: "JSON",
      viewImage: "View Image",
      hideImage: "Hide Image",
      listen: "Listen",
      hide: "Hide",
      viewPreview: "View Preview",
      hidePreview: "Hide Preview",
      view3dModel: "View 3D Model",
      hide3dModel: "Hide 3D Model",
      exportUEFN: "Export to UEFN",
      hideUEFNExport: "Hide UEFN Export",
      download: "Download",
      hideDownloads: "Hide Downloads",
      noVisualPreview: "No Visual Preview",
      resetView: "Reset",
      wireframe: "Wireframe",
      capturePNG: "Capture PNG",
      fullscreen: "Fullscreen",
      exitFullscreen: "Exit Fullscreen",
      viewJson: "View JSON",
      hideJson: "Hide JSON",
      viewReferences: "View References",
      hideReferences: "Hide References",
      copyJson: "Copy JSON",

      jsonUnavailable:
        "JSON is unavailable for this path.",

      previewLoading:
        "Finding the best verified preview…",

      previewUnavailable:
        "No deterministic visual preview is available for this asset yet.",

      vfxPreviewUnavailable:
        "This VFX asset does not have a deterministic still-image renderer yet.",

      islandsIds:
        "Islands & IDs",

      searchIslands:
        "Search islands / IDs",

      deviceMeshes:
        "Device Meshes",

      searchDevice:
        "Search device...",

      showAll:
        "Show All",

      hideUnavailable:
        "Hide Unavailable",

      cosmeticBrowser:
        "Cosmetic Browser",

      cosmeticNote:
        "Search outfits, emotes and back blings with visible icons.",

      cosmeticSearch:
        "Skin, emote, back bling, CID_, EID_ or BID_...",

      loadMore:
        "Load more",

      moreCosmeticIds:
        "For more cosmetics ids"
    },

    fr: {
      account: "Compte",
      accountInfo: "Informations du compte",
      accountStatus: "État du compte",
      usage: "Utilisation",
      theme: "Thème",
      siteTheme: "Thème du site",
      systemTheme: "Thème système",
      currentTheme: "(Actuel)",
      edit: "Modifier",
      profilePicture: "Photo de profil",
      signOut: "Se déconnecter",
      accountLogin: "Se connecter",
      apiConnected: "Connecté à OpenRouter",
      apiDisconnected: "Non connecté à OpenRouter",
      reConnect: "Reconnecter",
      signOutPrompt: "Se déconnecter de votre compte ?",
      logInPrompt: "Se connecter à votre compte ?",
      discordCommunity: "Rejoignez notre communauté Discord pour plus d’outils Fortnite et plus encore",
      joinNow: "Rejoindre",

      brand: "E8",
      newChat: "Nouveau chat",
      moreTools:
        "Plus d’outils Fortnite",
      settings: "Paramètres",
      recents: "Récents",

      welcomeTitle:
        "Discuter avec E8 Helper",

      welcomeSubtitle:
        "Fichiers Fortnite, UEFN, chemins d’assets et recherche.",

      messagePlaceholder:
        "Message E8 Helper",

      toolsTitle:
        "Plus d’outils Fortnite",

      searchTab: "Recherche",
      ids: "IDs",
      devices: "Appareils",
      convert: "Convertir",
      path: "Modificateur",
      cosmetic: "Cosmétiques",

      settingsTitle: "Paramètres",
      changeLanguage:
        "Changer la langue",
      language: "Langue",

      login: "Connexion",
      createNew:
        "Créer un compte",
      guest: "invité",

      accountFree:
        "Compte gratuit ou continuer en",

      accountSetup:
        "Configuration du compte",

      choosePhoto:
        "Choisir une photo",

      username:
        "Nom d’utilisateur",

      save: "Enregistrer",

      changeUsername:
        "Changer le nom d’utilisateur",

      usernameHint:
        "Écris ce que tu veux — 9 caractères max.",

      changeTheme:
        "Changer le thème",

      blackTheme:
        "Thème sombre",

      whiteTheme:
        "Thème clair",

      ownerAccounts:
        "Comptes du propriétaire",

      manualSearch:
        "Recherche manuelle",

      manualNote:
        "Recherche dans la base d’assets Fortnite sans envoyer la requête à l’IA.",

      searchPlaceholder:
        "Chemin/asset..",

      search: "Rechercher",
      searching: "Recherche",

      all: "Tous",
      newAssets: "Nouveaux",
      formatted: "Formaté",

      description:
        "Description",

      preview:
        "Aperçu",

      hidePreview:
        "Masquer l’aperçu",

      references:
        "Références",

      noReferences:
        "Aucune référence vérifiée n’a été renvoyée.",

      cooldownLeft:
        "Encore {seconds} s",

      pathModifier:
        "Modificateur de chemin",

      pathNote:
        "Convertit les chemins Fortnite en chemins d’objets Unreal adaptés au mount.",

      format: "Formater",
      addClassAction:
        "Ajouter _C",

      addClass:
        "Ajouter _C",

      classSkipped:
        "_C ignoré : cet asset ne semble pas compatible avec une classe.",

      convertedPath:
        "Le chemin converti apparaîtra ici",

      copy: "Copier",
      copied: "Copié",

      json: "JSON",
      viewImage: "Voir l’image",
      hideImage: "Masquer l’image",
      listen: "Écouter",
      hide: "Masquer",
      viewPreview: "Voir l’aperçu",
      hidePreview: "Masquer l’aperçu",
      view3dModel: "Voir le modèle 3D",
      hide3dModel: "Masquer le modèle 3D",
      exportUEFN: "Exporter vers UEFN",
      hideUEFNExport: "Masquer l’export UEFN",
      download: "Télécharger",
      hideDownloads: "Masquer les téléchargements",
      noVisualPreview: "Aucun aperçu visuel",
      resetView: "Réinitialiser",
      wireframe: "Fil de fer",
      capturePNG: "Capturer PNG",
      fullscreen: "Plein écran",
      exitFullscreen: "Quitter le plein écran",
      viewJson: "Voir JSON",
      hideJson: "Masquer JSON",
      viewReferences: "Voir les références",
      hideReferences: "Masquer les références",
      copyJson: "Copier JSON",

      jsonUnavailable:
        "JSON indisponible pour ce chemin.",

      previewLoading:
        "Recherche du meilleur aperçu vérifié…",

      previewUnavailable:
        "Aucun aperçu visuel déterministe n’est disponible pour cet asset.",

      vfxPreviewUnavailable:
        "Cet asset VFX n’a pas encore de rendu d’image fixe déterministe.",

      islandsIds:
        "Îles & IDs",

      searchIslands:
        "Rechercher îles / IDs",

      deviceMeshes:
        "Meshes des appareils",

      searchDevice:
        "Rechercher un appareil...",

      showAll:
        "Tout afficher",

      hideUnavailable:
        "Masquer indisponibles",

      cosmeticBrowser:
        "Navigateur de cosmétiques",

      cosmeticNote:
        "Recherche tenues, emotes et accessoires de dos avec leurs icônes.",

      cosmeticSearch:
        "Tenue, emote, accessoire, CID_, EID_ ou BID_...",

      loadMore:
        "Afficher plus",

      moreCosmeticIds:
        "Plus d’IDs de cosmétiques"
    },

    ar: {
      account: "الحساب",
      accountInfo: "معلومات الحساب",
      accountStatus: "حالة الحساب",
      usage: "الاستخدام",
      theme: "الثيم",
      siteTheme: "ثيم الموقع",
      systemTheme: "ثيم النظام",
      currentTheme: "(الحالي)",
      edit: "تعديل",
      profilePicture: "الصورة الشخصية",
      signOut: "تسجيل الخروج",
      accountLogin: "تسجيل الدخول",
      apiConnected: "متصل بـ OpenRouter",
      apiDisconnected: "غير متصل بـ OpenRouter",
      reConnect: "إعادة الربط",
      signOutPrompt: "تسجيل الخروج من حسابك؟",
      logInPrompt: "تسجيل الدخول إلى حسابك؟",
      discordCommunity: "انضم إلى مجتمعنا على Discord للمزيد من أدوات فورتنايت وغيرها",
      joinNow: "انضم الآن",

      brand: "E8",
      newChat: "محادثة جديدة",
      moreTools:
        "المزيد من أدوات فورتنايت",
      settings: "الإعدادات",
      recents:
        "المحادثات الأخيرة",

      welcomeTitle:
        "تحدث مع E8 Helper",

      welcomeSubtitle:
        "ملفات فورتنايت، FModel، UEFN، Verse، المسارات والبحث.",

      messagePlaceholder:
        "اكتب إلى E8 Helper",

      toolsTitle:
        "المزيد من أدوات فورتنايت",

      searchTab: "البحث",
      ids: "المعرفات",
      devices: "الأجهزة",
      convert: "التحويل",
      path: "معدّل المسار",
      cosmetic: "الكوزمتكس",

      settingsTitle: "الإعدادات",
      changeLanguage:
        "تغيير اللغة",
      language: "اللغة",

      login: "تسجيل الدخول",
      createNew:
        "إنشاء حساب",
      guest: "ضيف",

      accountFree:
        "حساب مجاني أو أكمل كـ",

      accountSetup:
        "إعداد الحساب",

      choosePhoto:
        "اختر صورة",

      username:
        "اسم المستخدم",

      save: "حفظ",

      changeUsername:
        "تغيير اسم المستخدم",

      usernameHint:
        "اكتب اللي تريده — الحد 9 أحرف.",

      changeTheme:
        "تغيير الثيم",

      blackTheme:
        "الثيم الداكن",

      whiteTheme:
        "الثيم الفاتح",

      ownerAccounts:
        "حسابات المالك",

      manualSearch:
        "البحث اليدوي",

      manualNote:
        "ابحث داخل قاعدة أصول فورتنايت بدون إرسال البحث للـAI.",

      searchPlaceholder:
        "ابحث عن مسار، asset، SM_، M_، MI_...",

      search: "بحث",
      searching:
        "جاري البحث",

      all: "الكل",
      newAssets: "الجديد",
      formatted: "منسق",

      description:
        "الوصف",

      preview:
        "المعاينة",

      hidePreview:
        "إخفاء المعاينة",

      references:
        "المراجع",

      noReferences:
        "ما رجعت أي مراجع مؤكدة.",

      cooldownLeft:
        "باقي {seconds} ث",

      pathModifier:
        "تعديل المسار",

      pathNote:
        "حوّل مسارات ملفات فورتنايت إلى Unreal object paths مع دعم الـmount.",

      format: "تنسيق",

      addClassAction:
        "إضافة _C",

      addClass:
        "إضافة _C",

      classSkipped:
        "ما تمت إضافة _C لأن الأصل ما يبين class-compatible.",

      convertedPath:
        "سيظهر المسار المحول هنا",

      copy: "نسخ",
      copied: "تم النسخ",

      json: "JSON",
      viewImage: "عرض الصورة",
      hideImage: "إخفاء الصورة",
      listen: "استماع",
      hide: "إخفاء",
      viewPreview: "عرض المعاينة",
      hidePreview: "إخفاء المعاينة",
      view3dModel: "عرض النموذج ثلاثي الأبعاد",
      hide3dModel: "إخفاء النموذج ثلاثي الأبعاد",
      exportUEFN: "تصدير إلى UEFN",
      hideUEFNExport: "إخفاء تصدير UEFN",
      download: "تنزيل",
      hideDownloads: "إخفاء التنزيلات",
      noVisualPreview: "لا توجد معاينة بصرية",
      resetView: "إعادة الضبط",
      wireframe: "الإطار السلكي",
      capturePNG: "التقاط PNG",
      fullscreen: "ملء الشاشة",
      exitFullscreen: "الخروج من ملء الشاشة",
      viewJson: "عرض JSON",
      hideJson: "إخفاء JSON",
      viewReferences: "عرض المراجع",
      hideReferences: "إخفاء المراجع",
      copyJson: "نسخ JSON",

      jsonUnavailable:
        "لا يوجد JSON متاح لهذا المسار.",

      previewLoading:
        "جاري البحث عن أفضل معاينة مؤكدة…",

      previewUnavailable:
        "حالياً ماكو معاينة بصرية حتمية لهذا الأصل.",

      vfxPreviewUnavailable:
        "هذا الـVFX حالياً ما عنده renderer حتمي لصورة ثابتة.",

      islandsIds:
        "الجزر والمعرفات",

      searchIslands:
        "ابحث عن جزيرة / ID",

      deviceMeshes:
        "Device Meshes",

      searchDevice:
        "ابحث عن جهاز...",

      showAll:
        "عرض الكل",

      hideUnavailable:
        "إخفاء غير المتاح",

      cosmeticBrowser:
        "متصفح الكوزمتكس",

      cosmeticNote:
        "ابحث عن السكنات والإيموتات والـBack Blings مع صورها.",

      cosmeticSearch:
        "سكن، إيموت، Back Bling، CID_ أو EID_ أو BID_...",

      loadMore:
        "عرض المزيد",

      moreCosmeticIds:
        "المزيد من Cosmetic IDs"
    }
  };

  function getLanguage() {
    let saved = "";

    try {
      saved =
        localStorage.getItem(
          STORAGE_KEY
        ) || "";
    } catch {
      saved = "";
    }

    return SUPPORTED.includes(
      saved
    )
      ? saved
      : "en";
  }

  function interpolate(
    value,
    params = {}
  ) {
    return String(value)
      .replace(
        /\{([A-Za-z0-9_]+)\}/g,
        (
          whole,
          key
        ) =>
          Object.prototype
            .hasOwnProperty
            .call(
              params,
              key
            )
            ? String(
                params[key]
              )
            : whole
      );
  }

  function t(
    key,
    fallbackOrParams,
    maybeParams
  ) {
    const lang =
      getLanguage();

    const translated =
      COPY[lang]?.[key] ??
      COPY.en?.[key];

    let fallback = key;
    let params = {};

    if (
      fallbackOrParams &&
      typeof fallbackOrParams ===
      "object" &&
      !Array.isArray(
        fallbackOrParams
      )
    ) {
      params =
        fallbackOrParams;
    } else {
      fallback =
        fallbackOrParams ??
        key;

      if (
        maybeParams &&
        typeof maybeParams ===
        "object"
      ) {
        params =
          maybeParams;
      }
    }

    return interpolate(
      translated ??
      fallback,
      params
    );
  }

  function apply(
    root = document
  ) {
    const lang =
      getLanguage();

    document.documentElement.lang =
      lang;

    document.documentElement.dir =
      lang === "ar"
        ? "rtl"
        : "ltr";

    root.querySelectorAll?.(
      "[data-i18n]"
    ).forEach(
      (element) => {
        element.textContent =
          t(
            element.dataset
              .i18n
          );
      }
    );

    root.querySelectorAll?.(
      "[data-i18n-placeholder]"
    ).forEach(
      (element) => {
        element.placeholder =
          t(
            element.dataset
              .i18nPlaceholder
          );
      }
    );

    root.querySelectorAll?.(
      "[data-set-language]"
    ).forEach(
      (element) => {
        element.classList.toggle(
          "active",
          element.dataset
            .setLanguage ===
            lang
        );
      }
    );
  }

  function setLanguage(
    lang
  ) {
    if (
      !SUPPORTED.includes(
        lang
      )
    ) {
      return false;
    }

    try {
      localStorage.setItem(
        STORAGE_KEY,
        lang
      );
    } catch {
      // The current page can still update even when storage is unavailable.
    }

    apply(document);

    window.dispatchEvent(
      new CustomEvent(
        "fortnite-language-changed",
        {
          detail: {
            language: lang
          }
        }
      )
    );

    return true;
  }

  document.addEventListener(
    "click",
    (event) => {
      const button =
        event.target.closest?.(
          "[data-set-language]"
        );

      if (!button) {
        return;
      }

      setLanguage(
        button.dataset
          .setLanguage
      );
    }
  );

  window.FortniteI18n =
    Object.freeze({
      version: "1.0.2",
      t,
      apply,
      setLanguage,
      getLanguage,
      supported:
        [...SUPPORTED]
    });

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      () =>
        apply(document),
      {
        once: true
      }
    );
  } else {
    apply(document);
  }
})();
