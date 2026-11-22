# PEF Design — Beta simplifiée : plan de migration sécurisé

## Décision validée (22 novembre 2026)
- Feed public sans compte; interface actuelle inchangée.
- Publication réservée à un seul administrateur.
- 2 à 5 photos par nouvelle annonce, vidéo facultative de 10 s en position 2.
- Favoris et WhatsApp conservés.
- Cloudflare D1 pour les annonces et R2 pour les médias.
- Les données Supabase et les 20 annonces migrées restent intactes pendant la transition.

## Sécurité impérative
Ne jamais supprimer les contrôles d'authentification des routes d'écriture. Ne jamais utiliser une adresse e-mail, un paramètre URL ou une clé intégrée au JavaScript public comme preuve d'identité administrateur.

## Travaux nécessaires avant ouverture
1. Inventorier les routes Worker et vérifier les accès Cloudflare D1/R2 (lecture publique, écriture privée).
2. Créer une authentification administrateur côté serveur (Cloudflare Access ou session sécurisée côté Worker), avec vérification sur chaque route POST/PATCH/DELETE et upload R2.
3. Vérifier l'origine CORS et les erreurs de l'API text-listings; tester les réponses avant d'intégrer au feed.
4. Ajouter une interface admin sur la même DA, sans rendre les boutons d'écriture publics.
5. Tester lecture, création, édition, suppression, upload, accès refusé aux non-admins, et préservation des données.
6. Déployer sur un environnement de test; ne basculer en production qu'après validation.

## État réel
La correction du feed est sur cette branche, mais son fonctionnement de bout en bout n'est pas vérifié. La connexion admin Cloudflare n'est pas encore implémentée. Aucun accès anonyme en écriture ne doit être activé.
