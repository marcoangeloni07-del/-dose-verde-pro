# Dose Verde Pro 1.7 — configurazione Archivio Cloud

La v1.7 è **local-first**: continua a funzionare senza cloud e senza Internet. Per condividere lo stesso archivio tra iPhone, iPad e PC serve configurare una volta Supabase.

## 1. Crea un progetto Supabase

Crea un progetto su Supabase. Nelle impostazioni del progetto recupera:

- **Project URL**
- **Publishable key** (oppure la legacy `anon key`)

Non usare mai la `service_role` / secret key nel browser o nelle variabili qui indicate.

## 2. Crea database e Storage

Apri **SQL Editor** in Supabase e incolla/esegui tutto il file `supabase_setup.sql`.

La configurazione crea:

- tabella `dose_verde_products`;
- Row Level Security: ogni utente vede/modifica solo i propri record;
- bucket privato `dose-verde-files`;
- policy per permettere a ciascun utente di accedere soltanto alla propria cartella di allegati.

## 3. Configura l'URL dell'app per Auth

In **Authentication → URL Configuration** imposta come Site URL:

`https://dose-verde-pro.vercel.app/`

Se usi anche altri domini Vercel, aggiungili tra i redirect consentiti.

## 4. Aggiungi le variabili in Vercel

Nel progetto Vercel → Settings → Environment Variables aggiungi:

- `SUPABASE_URL` = Project URL
- `SUPABASE_PUBLISHABLE_KEY` = Publishable key

In alternativa la v1.7 accetta anche `SUPABASE_ANON_KEY`.

Applica le variabili almeno a **Production** e fai un nuovo deploy.

## 5. Primo accesso

Apri Dose Verde → **Archivio → Archivio Cloud**.

1. Inserisci email e una password di almeno 8 caratteri.
2. Premi **Crea account**.
3. Se Supabase richiede conferma email, confermala.
4. Torna nell'app e premi **Accedi**.
5. La prima sincronizzazione unisce l'archivio locale con quello cloud.

Usa lo **stesso account** su iPhone, iPad e PC.

## Comportamento offline

Le modifiche vengono salvate subito sul dispositivo. Se sei offline, restano locali; al ritorno della rete la sincronizzazione riparte automaticamente.

## PDF

I PDF caricati localmente vengono inviati al bucket privato. Su un nuovo dispositivo il PDF viene scaricato solo quando premi **Apri PDF salvato**, quindi viene memorizzato anche nella cache locale del dispositivo.
