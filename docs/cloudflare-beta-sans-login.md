# PEF Design — bêta sans connexion (plan de migration)

Statut : préparation, NON déployé. Ne pas modifier la production avant les tests.

## Constat du code actuel
- `index.html` utilise le client Supabase, `sb.auth.getUser()`, des écritures `pef_objects` et des uploads média.
- Retirer seulement le formulaire de connexion ne rendrait PAS la publication fonctionnelle.
- D1 contient des annonces importées mais pas une authentification utilisable; R2 contient des médias copiés.
- Ne pas supprimer les originaux Supabase avant validation et sauvegarde.

## Architecture cible
- Site existant sur Vercel, API via Cloudflare Worker, D1 pour les données, R2 pour les médias.
- Publication anonyme autorisée uniquement par l'API, avec validation serveur, limitation de débit et protections anti-abus.
- Chaque annonce créée reçoit un identifiant public et un secret de gestion aléatoire (au moins 256 bits), remis une seule fois au navigateur.
- Le navigateur conserve le secret localement; D1 ne conserve qu'une empreinte cryptographique de ce secret.
- Modification/suppression exige ce secret; aucune opération de gestion ne doit accepter un simple identifiant d'annonce.
- Admin séparé avec authentification forte, jamais ouvert anonymement.
- Images: 2 à 5; vidéo optionnelle de 10 secondes en deuxième position.
- Upload R2 avec vérification de type, taille, durée, quotas et contrôle de l'association à l'annonce.
- CORS limité au domaine de l'application, aucun secret Cloudflare exposé dans le HTML.
- Prévoir `owner_user_id` nullable et un mécanisme de revendication d'annonce par un futur compte vérifié, avec preuve du secret de gestion.
- Aucune migration de mots de passe Supabase présumée possible.

## Conditions de mise en production
1. Worker et D1/R2 configurés et testés sans quota Supabase.
2. Publication, affichage, modification, suppression et reprise après rechargement testés sur mobile.
3. Contrôles anti-abus et accès administrateur testés.
4. Sauvegarde des anciennes données conservée.
5. Basculer la production seulement après validation explicite des tests.
