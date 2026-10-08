// Verbindung zur gemeinsamen Datenbank (Supabase).
// Beide Werte findest du im Supabase-Dashboard unter: Project Settings → API.
// Bleiben sie leer, läuft die App im lokalen Modus (Daten nur in diesem Browser).
//
// Der "anon"-Schlüssel ist öffentlich gedacht und darf hier stehen –
// geschützt sind die Daten durch die Anmeldung und die Regeln in supabase/schema.sql.
window.LAGER_CONFIG = {
  supabaseUrl: 'https://qigucziovbvhyiklzukt.supabase.co',
  supabaseAnonKey: 'sb_publishable_FdmKmTaHSTgbxfQihCMYTg_xKdovw9m',
};
