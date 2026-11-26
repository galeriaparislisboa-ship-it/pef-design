# Pilote PEF Design

Lancer le pilote avec Node.js 22 ou plus récent.

```sh
node pilot/server.mjs
```

Ouvrir http://127.0.0.1:4173. Le pilote tourne sur l’interface locale avec trois objets fictifs. Il conserve les données dans `PEF_PILOT_STATE` si défini, ou dans `/tmp/pef-pilot-state.json`.

- Sélection client. Choisir des pièces, enregistrer, ouvrir le lien dans un autre onglet, puis changer le prix ou le statut d’une pièce. Recharger la sélection pour voir la mise à jour. Désactiver le lien pour vérifier son expiration.
- Alertes. Créer une alerte Luminaires à Lisbonne jusqu’à 500 €. Baisser Neptune de 520 € à 490 €. Simuler le récapitulatif du jour, puis répéter pour vérifier la limite quotidienne.

Ce serveur de démonstration est réservé à un usage local. Le partage prépare un lien WhatsApp local. Pour tester le bouton de contact, lancer le serveur avec `PEF_PILOT_WHATSAPP` défini sur un numéro de test au format international, chiffres seuls. Le récapitulatif produit un aperçu sans envoyer d’e-mail. Les comptes, le catalogue Cloudflare et le site PEF sont indépendants de ce serveur.
