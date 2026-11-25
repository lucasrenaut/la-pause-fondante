export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const apiKey = process.env.SUMUP_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Configuration serveur incomplète (Clé SumUp)." });
  }

  const body = req.body || {};
  const action = body.action || 'create';

  // ============================================================================
  // ÉTAPE 2 : VÉRIFICATION DU PAIEMENT APRÈS RETOUR SUMUP + ENVOI EMAILJS
  // ============================================================================
  if (action === 'verify') {
    const { checkoutId, orderData } = body;

    if (!checkoutId) {
      return res.status(400).json({ error: 'Identifiant de paiement manquant.' });
    }

    try {
      const checkResponse = await fetch(`https://api.sumup.com/v0.1/checkouts/${encodeURIComponent(checkoutId)}`, {
        headers: { "Authorization": `Bearer ${apiKey}` }
      });
      const checkData = await checkResponse.json();

      if (!checkResponse.ok) {
        return res.status(500).json({ error: checkData.message || "Impossible de vérifier le paiement SumUp." });
      }

      // Si le paiement n'est pas validé (PENDING, FAILED, etc.), on ne fait rien
      if (checkData.status !== 'PAID') {
        return res.status(200).json({ paid: false, status: checkData.status });
      }

      // Paiement confirmé (PAID) : on envoie l'e-mail de notification via EmailJS
      if (orderData) {
        const {
          amount,
          sousTotal,
          fraisDePort,
          estLivraisonOfferte,
          pointRelais,
          clientEmail,
          cart,
          clientName,
          clientPhone,
          deliveryAddress,
          discount,
          remarque,
          remarques
        } = orderData;

        const serviceId = process.env.EMAILJS_SERVICE_ID || "service_cbfk3mr";
        const templateId = process.env.EMAILJS_TEMPLATE_ID || "template_jeryfp3";
        const publicKey = process.env.EMAILJS_PUBLIC_KEY || "rnYePJTMswP2wkX6O";
        const privateKey = process.env.EMAILJS_PRIVATE_KEY;

        const dateFormatee = new Date().toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        const articlesList = (cart || []).map(item =>
          `• ${item.quantity}x ${item.title}${item.subtitle ? ` (${item.subtitle})` : ''} — ${(item.price * item.quantity).toFixed(2).replace('.', ',')} €`
        ).join('\n');

        const templateParams = {
          to_email: "debstyle-coiffure@hotmail.com, renaut.lucas@outlook.fr, pooky49@hotmail.fr",
          date: dateFormatee,
          client_name: clientName || 'Client',
          client_email: clientEmail || 'Non renseigné',
          client_phone: clientPhone || 'Non renseigné',
          delivery_address: deliveryAddress || 'Non renseignée',
          point_relais: pointRelais || 'Livraison à domicile',
          articles_list: articlesList,
          details_articles: articlesList,
          subtotal: `${parseFloat(sousTotal || 0).toFixed(2).replace('.', ',')} €`,
          discount: discount || '0,00 €',
          shipping: estLivraisonOfferte ? "OFFERTS" : `${parseFloat(fraisDePort || 0).toFixed(2).replace('.', ',')} €`,
          total: `${parseFloat(amount || 0).toFixed(2).replace('.', ',')} €`,
          remarque: remarque || remarques || "Aucune consigne particulière"
        };

        const emailjsPayload = {
          service_id: serviceId,
          template_id: templateId,
          user_id: publicKey,
          template_params: templateParams
        };

        if (privateKey) {
          emailjsPayload.accessToken = privateKey;
        }

        try {
          const emailjsRes = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(emailjsPayload)
          });

          if (!emailjsRes.ok) {
            const errorDetails = await emailjsRes.text();
            console.error("Échec envoi EmailJS :", emailjsRes.status, errorDetails);
          }
        } catch (err) {
          console.error("Erreur réseau EmailJS :", err);
        }
      }

      return res.status(200).json({ paid: true, status: checkData.status });
    } catch (error) {
      console.error("Erreur vérification SumUp :", error);
      return res.status(500).json({ error: "Erreur serveur lors de la vérification du paiement." });
    }
  }

  // ============================================================================
  // ÉTAPE 1 : CRÉATION DE LA SESSION SUMUP (SANS ENVOYER L'E-MAIL NI DÉDUIRE)
  // ============================================================================
  const { amount, returnUrl } = body;

  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Montant invalide' });
  }

  let finalAmount = parseFloat(amount);
  if (finalAmount > 1000 && finalAmount % 100 === 0) {
    finalAmount = finalAmount / 100;
  }
  finalAmount = parseFloat(finalAmount.toFixed(2));

  try {
    // 1. Récupération des infos marchand SumUp
    const meResponse = await fetch("https://api.sumup.com/v0.1/me", {
      headers: { "Authorization": `Bearer ${apiKey}` }
    });
    const meData = await meResponse.json();
    const merchantCode = meData.merchant_profile?.merchant_code || meData.merchant_code;
    const merchantEmail = meData.account?.email || meData.email;

    // 2. Construction de l'URL de retour vers la page de paiement
    const baseReturnUrl = returnUrl || "https://la-pause-fondante.vercel.app/paiement_2.html";
    const separator = baseReturnUrl.includes('?') ? '&' : '?';
    const redirectUrl = `${baseReturnUrl}${separator}sumup_return=1`;

    // 3. Création de la session de paiement SumUp
    const checkoutBody = {
      checkout_reference: `LPF-${Date.now()}`,
      amount: finalAmount,
      currency: "EUR",
      description: "Commande - La pause Fondante",
      redirect_url: redirectUrl,
      hosted_checkout: { enabled: true }
    };

    if (merchantCode) {
      checkoutBody.merchant_code = merchantCode;
    } else if (merchantEmail) {
      checkoutBody.pay_to_email = merchantEmail;
    }

    const checkoutResponse = await fetch("https://api.sumup.com/v0.1/checkouts", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(checkoutBody)
    });

    const checkoutData = await checkoutResponse.json();

    if (checkoutResponse.ok && checkoutData.hosted_checkout_url) {
      return res.status(200).json({
        url: checkoutData.hosted_checkout_url,
        checkoutId: checkoutData.id
      });
    } else {
      return res.status(500).json({ error: checkoutData.message || "Erreur lors de la création du paiement SumUp." });
    }
  } catch (error) {
    console.error("Erreur serveur :", error);
    return res.status(500).json({ error: "Erreur serveur lors de la communication avec SumUp." });
  }
}