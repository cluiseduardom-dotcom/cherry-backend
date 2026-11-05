-- Lista fechada dos planos que a rota pública GET /publico/planos mostra (site da GiroNex, PO 05/11/2026).
-- Só Básico, Padrão e Pro (Semente, Cultivo, Pomar). Cortesia e planos legados são internos e nunca saem.
-- Padrão falso: plano novo não vaza para o site sem decisão explícita. Aditiva e idempotente.
-- Reversão manual: ALTER TABLE planos_comerciais DROP COLUMN IF EXISTS exibir_no_site;

ALTER TABLE planos_comerciais ADD COLUMN IF NOT EXISTS exibir_no_site BOOLEAN NOT NULL DEFAULT false;

UPDATE planos_comerciais SET exibir_no_site = true WHERE codigo IN ('basico', 'padrao', 'pro') AND exibir_no_site = false;
