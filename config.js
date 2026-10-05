// Verbindung zur gemeinsamen Datenbank (Supabase).
// Beide Werte findest du im Supabase-Dashboard unter: Project Settings → API.
// Bleiben sie leer, läuft die App im lokalen Modus (Daten nur in diesem Browser).
//
// Der "anon"-Schlüssel ist öffentlich gedacht und darf hier stehen –
// geschützt sind die Daten durch die Anmeldung und die Regeln in supabase/schema.sql.
window.LAGER_CONFIG = {
  supabaseUrl: '',      // z. B. 'https://abcdefgh.supabase.co'
  supabaseAnonKey: '',  // langer Schlüssel, beginnt mit 'eyJ…' oder 'sb_publishable_…'
};
