// Translation strings for Teluva.
// Keys cover: navigation, common buttons, section headings, AI chatbot UI.
// Deep form labels and placeholder text are left in English for now — browser
// translation (Chrome/Safari) handles the long tail automatically.

export interface Strings {
  // Navigation tabs
  nav_family: string;
  nav_calendar: string;
  nav_documents: string;
  nav_household: string;
  nav_finances: string;
  nav_info: string;
  nav_timeline: string;
  nav_assistant: string;
  nav_assets: string;
  nav_passwords: string;

  // Common buttons
  btn_save: string;
  btn_cancel: string;
  btn_close: string;
  btn_add: string;
  btn_edit: string;
  btn_delete: string;
  btn_apply: string;
  btn_back: string;
  btn_create: string;
  btn_join: string;
  btn_remove: string;
  btn_share: string;
  btn_copy: string;
  btn_upload: string;
  btn_scan: string;
  btn_done: string;
  btn_confirm: string;

  // Section headings
  heading_family_members: string;
  heading_medical: string;
  heading_identity: string;
  heading_education: string;
  heading_sizes: string;
  heading_travel: string;
  heading_preferences: string;
  heading_documents: string;
  heading_passports: string;
  heading_calendar: string;
  heading_household: string;
  heading_finances: string;
  heading_info: string;
  heading_timeline: string;
  heading_assets: string;
  heading_passwords: string;
  heading_settings: string;

  // AI chatbot
  ai_placeholder: string;
  ai_hint: string;
  ai_applied: string;
  ai_applying: string;
  ai_empty: string;

  // Onboarding
  onboard_title: string;
  onboard_start: string;
  onboard_start_sub: string;
  onboard_join: string;
  onboard_join_sub: string;
  onboard_family_name_label: string;
  onboard_family_name_placeholder: string;
  onboard_code_label: string;
  onboard_creating: string;
  onboard_joining: string;

  // Settings
  settings_invite_title: string;
  settings_invite_desc: string;
  settings_members_title: string;
  settings_share_btn: string;
  settings_copy_btn: string;

  // Common labels
  lbl_name: string;
  lbl_role: string;
  lbl_notes: string;
  lbl_date: string;
  lbl_total: string;
  lbl_all: string;
  lbl_search: string;
  lbl_loading: string;
  lbl_signout: string;
  lbl_language: string;

  // Status
  status_saved: string;
  status_sync_fail: string;
  status_copied: string;
  status_error: string;

  // App update (new-version banner)
  update_available: string;
  update_refresh: string;
}

export type LangCode = 'en' | 'de' | 'es' | 'fr' | 'pt' | 'it' | 'nl' | 'pl' | 'af';

export const LANGUAGE_NAMES: Record<LangCode, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  pt: 'Português',
  it: 'Italiano',
  nl: 'Nederlands',
  pl: 'Polski',
  af: 'Afrikaans',
};

const en: Strings = {
  update_available: 'New version available',
  update_refresh: 'Refresh update',
  nav_family: 'Family',
  nav_calendar: 'Calendar',
  nav_documents: 'Documents',
  nav_household: 'Household',
  nav_finances: 'Finances',
  nav_info: 'Info',
  nav_timeline: 'Timeline',
  nav_assistant: 'Assistant',
  nav_assets: 'Assets',
  nav_passwords: 'Passwords',

  btn_save: 'Save',
  btn_cancel: 'Cancel',
  btn_close: 'Close',
  btn_add: 'Add',
  btn_edit: 'Edit',
  btn_delete: 'Delete',
  btn_apply: 'Apply',
  btn_back: 'Back',
  btn_create: 'Create',
  btn_join: 'Join',
  btn_remove: 'Remove',
  btn_share: 'Share',
  btn_copy: 'Copy',
  btn_upload: 'Upload',
  btn_scan: 'Scan',
  btn_done: 'Done',
  btn_confirm: 'Confirm',

  heading_family_members: 'Family Members',
  heading_medical: 'Medical',
  heading_identity: 'Identity',
  heading_education: 'Education',
  heading_sizes: 'Sizes',
  heading_travel: 'Travel',
  heading_preferences: 'Preferences',
  heading_documents: 'Documents',
  heading_passports: 'Passports',
  heading_calendar: 'Family Calendar',
  heading_household: 'Household',
  heading_finances: 'Finances',
  heading_info: 'Important Info',
  heading_timeline: 'Family Timeline',
  heading_assets: 'Family Assets',
  heading_passwords: 'Family Passwords',
  heading_settings: 'Family Settings',

  ai_placeholder: 'Ask anything about your family…',
  ai_hint: 'Paste a screenshot with Ctrl+V · Nothing saves until you tap Apply.',
  ai_applied: 'Applied',
  ai_applying: 'Applying…',
  ai_empty: 'Ask me anything — sizes, medical info, passports, upcoming events — or tell me something to save.',

  onboard_title: 'Welcome',
  onboard_start: 'Start a new family',
  onboard_start_sub: 'Create your vault — you\'ll be the admin',
  onboard_join: 'Join with a code',
  onboard_join_sub: 'Enter the code your family admin shared',
  onboard_family_name_label: 'Family name',
  onboard_family_name_placeholder: 'e.g. The Clarks',
  onboard_code_label: 'Join code',
  onboard_creating: 'Creating…',
  onboard_joining: 'Joining…',

  settings_invite_title: 'Family Invite Link',
  settings_invite_desc: 'Send this link to anyone you want to add — they tap it, sign in with Google, and join instantly.',
  settings_members_title: 'Family Members',
  settings_share_btn: 'Share invite link',
  settings_copy_btn: 'Copy invite link',

  lbl_name: 'Name',
  lbl_role: 'Role',
  lbl_notes: 'Notes',
  lbl_date: 'Date',
  lbl_total: 'Total',
  lbl_all: 'All',
  lbl_search: 'Search',
  lbl_loading: 'Loading…',
  lbl_signout: 'Sign out',
  lbl_language: 'Language',

  status_saved: 'Saved',
  status_sync_fail: 'Saved on this device — cloud sync didn\'t go through.',
  status_copied: 'Link copied to clipboard!',
  status_error: 'Something went wrong. Please try again.',
};

const de: Strings = {
  update_available: 'Neue Version verfügbar',
  update_refresh: 'Jetzt aktualisieren',
  nav_family: 'Familie',
  nav_calendar: 'Kalender',
  nav_documents: 'Dokumente',
  nav_household: 'Haushalt',
  nav_finances: 'Finanzen',
  nav_info: 'Info',
  nav_timeline: 'Zeitstrahl',
  nav_assistant: 'Assistent',
  nav_assets: 'Inventar',
  nav_passwords: 'Passwörter',

  btn_save: 'Speichern',
  btn_cancel: 'Abbrechen',
  btn_close: 'Schließen',
  btn_add: 'Hinzufügen',
  btn_edit: 'Bearbeiten',
  btn_delete: 'Löschen',
  btn_apply: 'Übernehmen',
  btn_back: 'Zurück',
  btn_create: 'Erstellen',
  btn_join: 'Beitreten',
  btn_remove: 'Entfernen',
  btn_share: 'Teilen',
  btn_copy: 'Kopieren',
  btn_upload: 'Hochladen',
  btn_scan: 'Scannen',
  btn_done: 'Fertig',
  btn_confirm: 'Bestätigen',

  heading_family_members: 'Familienmitglieder',
  heading_medical: 'Medizinisch',
  heading_identity: 'Identität',
  heading_education: 'Bildung',
  heading_sizes: 'Größen',
  heading_travel: 'Reise',
  heading_preferences: 'Vorlieben',
  heading_documents: 'Dokumente',
  heading_passports: 'Reisepässe',
  heading_calendar: 'Familienkalender',
  heading_household: 'Haushalt',
  heading_finances: 'Finanzen',
  heading_info: 'Wichtige Info',
  heading_timeline: 'Familienverlauf',
  heading_assets: 'Inventar',
  heading_passwords: 'Passwörter',
  heading_settings: 'Familieneinstellungen',

  ai_placeholder: 'Frag alles über deine Familie…',
  ai_hint: 'Screenshot mit Strg+V einfügen · Nichts wird gespeichert bis du „Übernehmen" tippst.',
  ai_applied: 'Übernommen',
  ai_applying: 'Wird übernommen…',
  ai_empty: 'Frag mich alles — Größen, medizinische Infos, Pässe, Termine — oder sag mir etwas zum Speichern.',

  onboard_title: 'Willkommen',
  onboard_start: 'Neue Familie anlegen',
  onboard_start_sub: 'Erstelle deinen Tresor — du bist der Admin',
  onboard_join: 'Mit Code beitreten',
  onboard_join_sub: 'Gib den Code ein, den dein Familienadmin geteilt hat',
  onboard_family_name_label: 'Familienname',
  onboard_family_name_placeholder: 'z.B. Familie Müller',
  onboard_code_label: 'Beitrittscode',
  onboard_creating: 'Wird erstellt…',
  onboard_joining: 'Wird beigetreten…',

  settings_invite_title: 'Einladungslink',
  settings_invite_desc: 'Sende diesen Link an jeden, den du hinzufügen möchtest — er tippt darauf, meldet sich mit Google an und tritt sofort bei.',
  settings_members_title: 'Familienmitglieder',
  settings_share_btn: 'Einladungslink teilen',
  settings_copy_btn: 'Einladungslink kopieren',

  lbl_name: 'Name',
  lbl_role: 'Rolle',
  lbl_notes: 'Notizen',
  lbl_date: 'Datum',
  lbl_total: 'Gesamt',
  lbl_all: 'Alle',
  lbl_search: 'Suchen',
  lbl_loading: 'Lädt…',
  lbl_signout: 'Abmelden',
  lbl_language: 'Sprache',

  status_saved: 'Gespeichert',
  status_sync_fail: 'Auf diesem Gerät gespeichert — Cloud-Sync fehlgeschlagen.',
  status_copied: 'Link in die Zwischenablage kopiert!',
  status_error: 'Etwas ist schiefgelaufen. Bitte versuche es erneut.',
};

const es: Strings = {
  update_available: 'Nueva versión disponible',
  update_refresh: 'Actualizar ahora',
  nav_family: 'Familia',
  nav_calendar: 'Calendario',
  nav_documents: 'Documentos',
  nav_household: 'Hogar',
  nav_finances: 'Finanzas',
  nav_info: 'Info',
  nav_timeline: 'Cronología',
  nav_assistant: 'Asistente',
  nav_assets: 'Activos',
  nav_passwords: 'Contraseñas',

  btn_save: 'Guardar',
  btn_cancel: 'Cancelar',
  btn_close: 'Cerrar',
  btn_add: 'Añadir',
  btn_edit: 'Editar',
  btn_delete: 'Eliminar',
  btn_apply: 'Aplicar',
  btn_back: 'Volver',
  btn_create: 'Crear',
  btn_join: 'Unirse',
  btn_remove: 'Quitar',
  btn_share: 'Compartir',
  btn_copy: 'Copiar',
  btn_upload: 'Subir',
  btn_scan: 'Escanear',
  btn_done: 'Listo',
  btn_confirm: 'Confirmar',

  heading_family_members: 'Miembros de la familia',
  heading_medical: 'Médico',
  heading_identity: 'Identidad',
  heading_education: 'Educación',
  heading_sizes: 'Tallas',
  heading_travel: 'Viaje',
  heading_preferences: 'Preferencias',
  heading_documents: 'Documentos',
  heading_passports: 'Pasaportes',
  heading_calendar: 'Calendario familiar',
  heading_household: 'Hogar',
  heading_finances: 'Finanzas',
  heading_info: 'Info importante',
  heading_timeline: 'Cronología familiar',
  heading_assets: 'Inventario',
  heading_passwords: 'Contraseñas',
  heading_settings: 'Configuración familiar',

  ai_placeholder: 'Pregunta lo que quieras sobre tu familia…',
  ai_hint: 'Pega una captura con Ctrl+V · Nada se guarda hasta que pulses Aplicar.',
  ai_applied: 'Aplicado',
  ai_applying: 'Aplicando…',
  ai_empty: 'Pregúntame lo que quieras — tallas, info médica, pasaportes, eventos — o dime algo para guardar.',

  onboard_title: 'Bienvenido',
  onboard_start: 'Crear una nueva familia',
  onboard_start_sub: 'Crea tu bóveda — serás el administrador',
  onboard_join: 'Unirse con un código',
  onboard_join_sub: 'Introduce el código que compartió tu administrador familiar',
  onboard_family_name_label: 'Nombre de familia',
  onboard_family_name_placeholder: 'ej. Los García',
  onboard_code_label: 'Código de acceso',
  onboard_creating: 'Creando…',
  onboard_joining: 'Uniéndose…',

  settings_invite_title: 'Enlace de invitación',
  settings_invite_desc: 'Envía este enlace a quien quieras añadir — lo pulsa, inicia sesión con Google y se une al instante.',
  settings_members_title: 'Miembros de la familia',
  settings_share_btn: 'Compartir enlace de invitación',
  settings_copy_btn: 'Copiar enlace de invitación',

  lbl_name: 'Nombre',
  lbl_role: 'Rol',
  lbl_notes: 'Notas',
  lbl_date: 'Fecha',
  lbl_total: 'Total',
  lbl_all: 'Todos',
  lbl_search: 'Buscar',
  lbl_loading: 'Cargando…',
  lbl_signout: 'Cerrar sesión',
  lbl_language: 'Idioma',

  status_saved: 'Guardado',
  status_sync_fail: 'Guardado en este dispositivo — la sincronización en la nube falló.',
  status_copied: '¡Enlace copiado al portapapeles!',
  status_error: 'Algo salió mal. Por favor, inténtalo de nuevo.',
};

const fr: Strings = {
  update_available: 'Nouvelle version disponible',
  update_refresh: 'Mettre à jour',
  nav_family: 'Famille',
  nav_calendar: 'Calendrier',
  nav_documents: 'Documents',
  nav_household: 'Maison',
  nav_finances: 'Finances',
  nav_info: 'Info',
  nav_timeline: 'Chronologie',
  nav_assistant: 'Assistant',
  nav_assets: 'Inventaire',
  nav_passwords: 'Mots de passe',

  btn_save: 'Enregistrer',
  btn_cancel: 'Annuler',
  btn_close: 'Fermer',
  btn_add: 'Ajouter',
  btn_edit: 'Modifier',
  btn_delete: 'Supprimer',
  btn_apply: 'Appliquer',
  btn_back: 'Retour',
  btn_create: 'Créer',
  btn_join: 'Rejoindre',
  btn_remove: 'Retirer',
  btn_share: 'Partager',
  btn_copy: 'Copier',
  btn_upload: 'Téléverser',
  btn_scan: 'Scanner',
  btn_done: 'Terminé',
  btn_confirm: 'Confirmer',

  heading_family_members: 'Membres de la famille',
  heading_medical: 'Médical',
  heading_identity: 'Identité',
  heading_education: 'Éducation',
  heading_sizes: 'Tailles',
  heading_travel: 'Voyage',
  heading_preferences: 'Préférences',
  heading_documents: 'Documents',
  heading_passports: 'Passeports',
  heading_calendar: 'Calendrier familial',
  heading_household: 'Maison',
  heading_finances: 'Finances',
  heading_info: 'Info importante',
  heading_timeline: 'Chronologie familiale',
  heading_assets: 'Inventaire',
  heading_passwords: 'Mots de passe',
  heading_settings: 'Paramètres familiaux',

  ai_placeholder: 'Posez n\'importe quelle question sur votre famille…',
  ai_hint: 'Collez une capture avec Ctrl+V · Rien n\'est enregistré jusqu\'à ce que vous appuyiez sur Appliquer.',
  ai_applied: 'Appliqué',
  ai_applying: 'Application…',
  ai_empty: 'Posez-moi n\'importe quelle question — tailles, infos médicales, passeports, événements — ou dites-moi quelque chose à sauvegarder.',

  onboard_title: 'Bienvenue',
  onboard_start: 'Créer une nouvelle famille',
  onboard_start_sub: 'Créez votre coffre-fort — vous serez l\'administrateur',
  onboard_join: 'Rejoindre avec un code',
  onboard_join_sub: 'Entrez le code partagé par votre administrateur familial',
  onboard_family_name_label: 'Nom de famille',
  onboard_family_name_placeholder: 'ex. Les Dupont',
  onboard_code_label: 'Code d\'accès',
  onboard_creating: 'Création…',
  onboard_joining: 'Connexion…',

  settings_invite_title: 'Lien d\'invitation',
  settings_invite_desc: 'Envoyez ce lien à quelqu\'un que vous souhaitez ajouter — il appuie dessus, se connecte avec Google et rejoint instantanément.',
  settings_members_title: 'Membres de la famille',
  settings_share_btn: 'Partager le lien d\'invitation',
  settings_copy_btn: 'Copier le lien d\'invitation',

  lbl_name: 'Nom',
  lbl_role: 'Rôle',
  lbl_notes: 'Notes',
  lbl_date: 'Date',
  lbl_total: 'Total',
  lbl_all: 'Tous',
  lbl_search: 'Rechercher',
  lbl_loading: 'Chargement…',
  lbl_signout: 'Se déconnecter',
  lbl_language: 'Langue',

  status_saved: 'Enregistré',
  status_sync_fail: 'Enregistré sur cet appareil — synchronisation cloud échouée.',
  status_copied: 'Lien copié dans le presse-papiers !',
  status_error: 'Quelque chose s\'est mal passé. Veuillez réessayer.',
};

const pt: Strings = {
  update_available: 'Nova versão disponível',
  update_refresh: 'Atualizar agora',
  nav_family: 'Família',
  nav_calendar: 'Calendário',
  nav_documents: 'Documentos',
  nav_household: 'Casa',
  nav_finances: 'Finanças',
  nav_info: 'Info',
  nav_timeline: 'Linha do Tempo',
  nav_assistant: 'Assistente',
  nav_assets: 'Bens',
  nav_passwords: 'Senhas',

  btn_save: 'Guardar',
  btn_cancel: 'Cancelar',
  btn_close: 'Fechar',
  btn_add: 'Adicionar',
  btn_edit: 'Editar',
  btn_delete: 'Eliminar',
  btn_apply: 'Aplicar',
  btn_back: 'Voltar',
  btn_create: 'Criar',
  btn_join: 'Entrar',
  btn_remove: 'Remover',
  btn_share: 'Partilhar',
  btn_copy: 'Copiar',
  btn_upload: 'Carregar',
  btn_scan: 'Digitalizar',
  btn_done: 'Concluído',
  btn_confirm: 'Confirmar',

  heading_family_members: 'Membros da família',
  heading_medical: 'Médico',
  heading_identity: 'Identidade',
  heading_education: 'Educação',
  heading_sizes: 'Tamanhos',
  heading_travel: 'Viagem',
  heading_preferences: 'Preferências',
  heading_documents: 'Documentos',
  heading_passports: 'Passaportes',
  heading_calendar: 'Calendário familiar',
  heading_household: 'Casa',
  heading_finances: 'Finanças',
  heading_info: 'Info importante',
  heading_timeline: 'Linha do tempo familiar',
  heading_assets: 'Inventário',
  heading_passwords: 'Senhas',
  heading_settings: 'Definições familiares',

  ai_placeholder: 'Pergunte qualquer coisa sobre a sua família…',
  ai_hint: 'Cole uma captura com Ctrl+V · Nada é guardado até tocar em Aplicar.',
  ai_applied: 'Aplicado',
  ai_applying: 'A aplicar…',
  ai_empty: 'Pergunte-me o que quiser — tamanhos, info médica, passaportes, eventos — ou diga-me algo para guardar.',

  onboard_title: 'Bem-vindo',
  onboard_start: 'Criar uma nova família',
  onboard_start_sub: 'Crie o seu cofre — será o administrador',
  onboard_join: 'Entrar com um código',
  onboard_join_sub: 'Introduza o código partilhado pelo seu administrador familiar',
  onboard_family_name_label: 'Nome de família',
  onboard_family_name_placeholder: 'ex. Os Silva',
  onboard_code_label: 'Código de acesso',
  onboard_creating: 'A criar…',
  onboard_joining: 'A entrar…',

  settings_invite_title: 'Link de convite',
  settings_invite_desc: 'Envie este link a quem quiser adicionar — toca nele, inicia sessão com o Google e entra de imediato.',
  settings_members_title: 'Membros da família',
  settings_share_btn: 'Partilhar link de convite',
  settings_copy_btn: 'Copiar link de convite',

  lbl_name: 'Nome',
  lbl_role: 'Função',
  lbl_notes: 'Notas',
  lbl_date: 'Data',
  lbl_total: 'Total',
  lbl_all: 'Todos',
  lbl_search: 'Pesquisar',
  lbl_loading: 'A carregar…',
  lbl_signout: 'Terminar sessão',
  lbl_language: 'Idioma',

  status_saved: 'Guardado',
  status_sync_fail: 'Guardado neste dispositivo — a sincronização com a cloud falhou.',
  status_copied: 'Link copiado para a área de transferência!',
  status_error: 'Algo correu mal. Por favor, tente novamente.',
};

const it: Strings = {
  update_available: 'Nuova versione disponibile',
  update_refresh: 'Aggiorna ora',
  nav_family: 'Famiglia',
  nav_calendar: 'Calendario',
  nav_documents: 'Documenti',
  nav_household: 'Casa',
  nav_finances: 'Finanze',
  nav_info: 'Info',
  nav_timeline: 'Cronologia',
  nav_assistant: 'Assistente',
  nav_assets: 'Beni',
  nav_passwords: 'Password',

  btn_save: 'Salva',
  btn_cancel: 'Annulla',
  btn_close: 'Chiudi',
  btn_add: 'Aggiungi',
  btn_edit: 'Modifica',
  btn_delete: 'Elimina',
  btn_apply: 'Applica',
  btn_back: 'Indietro',
  btn_create: 'Crea',
  btn_join: 'Unisciti',
  btn_remove: 'Rimuovi',
  btn_share: 'Condividi',
  btn_copy: 'Copia',
  btn_upload: 'Carica',
  btn_scan: 'Scansiona',
  btn_done: 'Fatto',
  btn_confirm: 'Conferma',

  heading_family_members: 'Membri della famiglia',
  heading_medical: 'Medico',
  heading_identity: 'Identità',
  heading_education: 'Istruzione',
  heading_sizes: 'Taglie',
  heading_travel: 'Viaggi',
  heading_preferences: 'Preferenze',
  heading_documents: 'Documenti',
  heading_passports: 'Passaporti',
  heading_calendar: 'Calendario di famiglia',
  heading_household: 'Casa',
  heading_finances: 'Finanze',
  heading_info: 'Info importanti',
  heading_timeline: 'Cronologia di famiglia',
  heading_assets: 'Inventario',
  heading_passwords: 'Password',
  heading_settings: 'Impostazioni di famiglia',

  ai_placeholder: 'Chiedi qualsiasi cosa sulla tua famiglia…',
  ai_hint: 'Incolla uno screenshot con Ctrl+V · Niente viene salvato finché non tocchi Applica.',
  ai_applied: 'Applicato',
  ai_applying: 'Applicazione…',
  ai_empty: 'Chiedimi qualsiasi cosa — taglie, info mediche, passaporti, eventi — o dimmi qualcosa da salvare.',

  onboard_title: 'Benvenuto',
  onboard_start: 'Crea una nuova famiglia',
  onboard_start_sub: 'Crea il tuo vault — sarai l\'amministratore',
  onboard_join: 'Unisciti con un codice',
  onboard_join_sub: 'Inserisci il codice condiviso dal tuo amministratore di famiglia',
  onboard_family_name_label: 'Nome di famiglia',
  onboard_family_name_placeholder: 'es. I Rossi',
  onboard_code_label: 'Codice di accesso',
  onboard_creating: 'Creazione…',
  onboard_joining: 'Accesso…',

  settings_invite_title: 'Link di invito',
  settings_invite_desc: 'Invia questo link a chiunque vuoi aggiungere — lo tocca, accede con Google e si unisce immediatamente.',
  settings_members_title: 'Membri della famiglia',
  settings_share_btn: 'Condividi link di invito',
  settings_copy_btn: 'Copia link di invito',

  lbl_name: 'Nome',
  lbl_role: 'Ruolo',
  lbl_notes: 'Note',
  lbl_date: 'Data',
  lbl_total: 'Totale',
  lbl_all: 'Tutti',
  lbl_search: 'Cerca',
  lbl_loading: 'Caricamento…',
  lbl_signout: 'Esci',
  lbl_language: 'Lingua',

  status_saved: 'Salvato',
  status_sync_fail: 'Salvato su questo dispositivo — la sincronizzazione cloud non è riuscita.',
  status_copied: 'Link copiato negli appunti!',
  status_error: 'Qualcosa è andato storto. Per favore riprova.',
};

const nl: Strings = {
  update_available: 'Nieuwe versie beschikbaar',
  update_refresh: 'Nu vernieuwen',
  nav_family: 'Familie',
  nav_calendar: 'Kalender',
  nav_documents: 'Documenten',
  nav_household: 'Huishouden',
  nav_finances: 'Financiën',
  nav_info: 'Info',
  nav_timeline: 'Tijdlijn',
  nav_assistant: 'Assistent',
  nav_assets: 'Bezittingen',
  nav_passwords: 'Wachtwoorden',

  btn_save: 'Opslaan',
  btn_cancel: 'Annuleren',
  btn_close: 'Sluiten',
  btn_add: 'Toevoegen',
  btn_edit: 'Bewerken',
  btn_delete: 'Verwijderen',
  btn_apply: 'Toepassen',
  btn_back: 'Terug',
  btn_create: 'Aanmaken',
  btn_join: 'Deelnemen',
  btn_remove: 'Verwijderen',
  btn_share: 'Delen',
  btn_copy: 'Kopiëren',
  btn_upload: 'Uploaden',
  btn_scan: 'Scannen',
  btn_done: 'Klaar',
  btn_confirm: 'Bevestigen',

  heading_family_members: 'Familieleden',
  heading_medical: 'Medisch',
  heading_identity: 'Identiteit',
  heading_education: 'Onderwijs',
  heading_sizes: 'Maten',
  heading_travel: 'Reizen',
  heading_preferences: 'Voorkeuren',
  heading_documents: 'Documenten',
  heading_passports: 'Paspoorten',
  heading_calendar: 'Familiekalender',
  heading_household: 'Huishouden',
  heading_finances: 'Financiën',
  heading_info: 'Belangrijke info',
  heading_timeline: 'Familietijdlijn',
  heading_assets: 'Inventaris',
  heading_passwords: 'Wachtwoorden',
  heading_settings: 'Familiesinstellingen',

  ai_placeholder: 'Vraag alles over je familie…',
  ai_hint: 'Plak een schermafbeelding met Ctrl+V · Niets wordt opgeslagen totdat je op Toepassen tikt.',
  ai_applied: 'Toegepast',
  ai_applying: 'Toepassen…',
  ai_empty: 'Vraag me alles — maten, medische info, paspoorten, evenementen — of vertel me iets om op te slaan.',

  onboard_title: 'Welkom',
  onboard_start: 'Een nieuwe familie aanmaken',
  onboard_start_sub: 'Maak je kluis aan — jij bent de beheerder',
  onboard_join: 'Deelnemen met een code',
  onboard_join_sub: 'Voer de code in die je familiebeheerder heeft gedeeld',
  onboard_family_name_label: 'Familienaam',
  onboard_family_name_placeholder: 'bijv. De Jansen',
  onboard_code_label: 'Deelnamecode',
  onboard_creating: 'Aanmaken…',
  onboard_joining: 'Deelnemen…',

  settings_invite_title: 'Uitnodigingslink',
  settings_invite_desc: 'Stuur deze link naar iemand die je wilt toevoegen — ze tikken erop, melden zich aan met Google en zijn direct lid.',
  settings_members_title: 'Familieleden',
  settings_share_btn: 'Uitnodigingslink delen',
  settings_copy_btn: 'Uitnodigingslink kopiëren',

  lbl_name: 'Naam',
  lbl_role: 'Rol',
  lbl_notes: 'Notities',
  lbl_date: 'Datum',
  lbl_total: 'Totaal',
  lbl_all: 'Alle',
  lbl_search: 'Zoeken',
  lbl_loading: 'Laden…',
  lbl_signout: 'Uitloggen',
  lbl_language: 'Taal',

  status_saved: 'Opgeslagen',
  status_sync_fail: 'Opgeslagen op dit apparaat — cloudsynchronisatie mislukt.',
  status_copied: 'Link gekopieerd naar klembord!',
  status_error: 'Er is iets misgegaan. Probeer het opnieuw.',
};

const pl: Strings = {
  update_available: 'Dostępna nowa wersja',
  update_refresh: 'Odśwież teraz',
  nav_family: 'Rodzina',
  nav_calendar: 'Kalendarz',
  nav_documents: 'Dokumenty',
  nav_household: 'Dom',
  nav_finances: 'Finanse',
  nav_info: 'Info',
  nav_timeline: 'Oś czasu',
  nav_assistant: 'Asystent',
  nav_assets: 'Majątek',
  nav_passwords: 'Hasła',

  btn_save: 'Zapisz',
  btn_cancel: 'Anuluj',
  btn_close: 'Zamknij',
  btn_add: 'Dodaj',
  btn_edit: 'Edytuj',
  btn_delete: 'Usuń',
  btn_apply: 'Zastosuj',
  btn_back: 'Wróć',
  btn_create: 'Utwórz',
  btn_join: 'Dołącz',
  btn_remove: 'Usuń',
  btn_share: 'Udostępnij',
  btn_copy: 'Kopiuj',
  btn_upload: 'Prześlij',
  btn_scan: 'Skanuj',
  btn_done: 'Gotowe',
  btn_confirm: 'Potwierdź',

  heading_family_members: 'Członkowie rodziny',
  heading_medical: 'Medyczne',
  heading_identity: 'Tożsamość',
  heading_education: 'Edukacja',
  heading_sizes: 'Rozmiary',
  heading_travel: 'Podróże',
  heading_preferences: 'Preferencje',
  heading_documents: 'Dokumenty',
  heading_passports: 'Paszporty',
  heading_calendar: 'Kalendarz rodzinny',
  heading_household: 'Dom',
  heading_finances: 'Finanse',
  heading_info: 'Ważne informacje',
  heading_timeline: 'Oś czasu rodziny',
  heading_assets: 'Inwentarz',
  heading_passwords: 'Hasła',
  heading_settings: 'Ustawienia rodziny',

  ai_placeholder: 'Zapytaj o cokolwiek dotyczącego rodziny…',
  ai_hint: 'Wklej zrzut ekranu przez Ctrl+V · Nic nie zostanie zapisane, dopóki nie naciśniesz Zastosuj.',
  ai_applied: 'Zastosowano',
  ai_applying: 'Stosowanie…',
  ai_empty: 'Zapytaj mnie o cokolwiek — rozmiary, informacje medyczne, paszporty, wydarzenia — lub powiedz mi coś do zapisania.',

  onboard_title: 'Witaj',
  onboard_start: 'Utwórz nową rodzinę',
  onboard_start_sub: 'Utwórz swój skarbiec — będziesz administratorem',
  onboard_join: 'Dołącz z kodem',
  onboard_join_sub: 'Wprowadź kod udostępniony przez administratora rodziny',
  onboard_family_name_label: 'Nazwa rodziny',
  onboard_family_name_placeholder: 'np. Rodzina Kowalskich',
  onboard_code_label: 'Kod dostępu',
  onboard_creating: 'Tworzenie…',
  onboard_joining: 'Dołączanie…',

  settings_invite_title: 'Link zaproszenia',
  settings_invite_desc: 'Wyślij ten link komuś, kogo chcesz dodać — dotyka go, loguje się przez Google i natychmiast dołącza.',
  settings_members_title: 'Członkowie rodziny',
  settings_share_btn: 'Udostępnij link zaproszenia',
  settings_copy_btn: 'Kopiuj link zaproszenia',

  lbl_name: 'Imię',
  lbl_role: 'Rola',
  lbl_notes: 'Notatki',
  lbl_date: 'Data',
  lbl_total: 'Łącznie',
  lbl_all: 'Wszyscy',
  lbl_search: 'Szukaj',
  lbl_loading: 'Ładowanie…',
  lbl_signout: 'Wyloguj',
  lbl_language: 'Język',

  status_saved: 'Zapisano',
  status_sync_fail: 'Zapisano na tym urządzeniu — synchronizacja z chmurą nie powiodła się.',
  status_copied: 'Link skopiowany do schowka!',
  status_error: 'Coś poszło nie tak. Spróbuj ponownie.',
};

const af: Strings = {
  update_available: 'Nuwe weergawe beskikbaar',
  update_refresh: 'Herlaai nou',
  nav_family: 'Familie',
  nav_calendar: 'Kalender',
  nav_documents: 'Dokumente',
  nav_household: 'Huishouding',
  nav_finances: 'Finansies',
  nav_info: 'Info',
  nav_timeline: 'Tydlyn',
  nav_assistant: 'Assistent',
  nav_assets: 'Bates',
  nav_passwords: 'Wagwoorde',

  btn_save: 'Stoor',
  btn_cancel: 'Kanselleer',
  btn_close: 'Sluit',
  btn_add: 'Voeg by',
  btn_edit: 'Wysig',
  btn_delete: 'Verwyder',
  btn_apply: 'Pas toe',
  btn_back: 'Terug',
  btn_create: 'Skep',
  btn_join: 'Sluit aan',
  btn_remove: 'Verwyder',
  btn_share: 'Deel',
  btn_copy: 'Kopieer',
  btn_upload: 'Laai op',
  btn_scan: 'Skandeer',
  btn_done: 'Klaar',
  btn_confirm: 'Bevestig',

  heading_family_members: 'Familielede',
  heading_medical: 'Mediese',
  heading_identity: 'Identiteit',
  heading_education: 'Opvoeding',
  heading_sizes: 'Groottes',
  heading_travel: 'Reis',
  heading_preferences: 'Voorkeure',
  heading_documents: 'Dokumente',
  heading_passports: 'Paspoorte',
  heading_calendar: 'Familiekalender',
  heading_household: 'Huishouding',
  heading_finances: 'Finansies',
  heading_info: 'Belangrike info',
  heading_timeline: 'Familie-tydlyn',
  heading_assets: 'Inventaris',
  heading_passwords: 'Wagwoorde',
  heading_settings: 'Familie-instellings',

  ai_placeholder: 'Vra enigiets oor jou familie…',
  ai_hint: 'Plak \'n skermkiekie met Ctrl+V · Niks word gestoor totdat jy op Pas toe druk nie.',
  ai_applied: 'Toegepas',
  ai_applying: 'Besig om toe te pas…',
  ai_empty: 'Vra my enigiets — groottes, mediese inligting, paspoorte, geleenthede — of vertel my iets om te stoor.',

  onboard_title: 'Welkom',
  onboard_start: 'Begin \'n nuwe familie',
  onboard_start_sub: 'Skep jou kluis — jy sal die administrateur wees',
  onboard_join: 'Sluit aan met \'n kode',
  onboard_join_sub: 'Voer die kode in wat jou familie-administrateur gedeel het',
  onboard_family_name_label: 'Familienaam',
  onboard_family_name_placeholder: 'bv. Die Clarks',
  onboard_code_label: 'Aansluitekode',
  onboard_creating: 'Skep besig…',
  onboard_joining: 'Aansluit besig…',

  settings_invite_title: 'Uitnodigingsskakel',
  settings_invite_desc: 'Stuur hierdie skakel na enigeen wat jy wil byvoeg — hulle tik daarop, meld aan met Google en sluit onmiddellik aan.',
  settings_members_title: 'Familielede',
  settings_share_btn: 'Deel uitnodigingsskakel',
  settings_copy_btn: 'Kopieer uitnodigingsskakel',

  lbl_name: 'Naam',
  lbl_role: 'Rol',
  lbl_notes: 'Notas',
  lbl_date: 'Datum',
  lbl_total: 'Totaal',
  lbl_all: 'Almal',
  lbl_search: 'Soek',
  lbl_loading: 'Laai…',
  lbl_signout: 'Teken uit',
  lbl_language: 'Taal',

  status_saved: 'Gestoor',
  status_sync_fail: 'Gestoor op hierdie toestel — wolk-sinkronisasie het misluk.',
  status_copied: 'Skakel na knipbord gekopieer!',
  status_error: 'Iets het verkeerd gegaan. Probeer asseblief weer.',
};

export const LOCALES: Record<LangCode, Strings> = { en, de, es, fr, pt, it, nl, pl, af };

const STORAGE_KEY = 'fv_lang';

export function getStoredLang(): LangCode {
  const stored = localStorage.getItem(STORAGE_KEY) as LangCode | null;
  if (stored && stored in LOCALES) return stored;
  // Detect from browser
  const browser = (navigator.language || 'en').slice(0, 2).toLowerCase() as LangCode;
  return browser in LOCALES ? browser : 'en';
}

export function setStoredLang(lang: LangCode) {
  localStorage.setItem(STORAGE_KEY, lang);
}
