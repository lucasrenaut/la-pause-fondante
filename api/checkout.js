export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { amount, sousTotal, fraisDePort, estLivraisonOfferte, pointRelais, clientEmail, cart, clientName, clientPhone, deliveryAddress, discount } = req.body || {};
  
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Montant invalide' });
  }

  const apiKey = process.env.SUMUP_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Configuration serveur incomplète (Clé SumUp)." });
  }

  try {
    // 1. Récupération des infos marchand SumUp
    const meResponse = await fetch("https://api.sumup.com/v0.1/me", {
      headers: { "Authorization": `Bearer ${apiKey}` }
    });
    const meData = await meResponse.json();
    const merchantCode = meData.merchant_profile?.merchant_code || meData.merchant_code;
    const merchantEmail = meData.account?.email || meData.email;

    // 2. Création de la session de paiement SumUp
    const checkoutBody = {
      checkout_reference: `LPF-${Date.now()}`,
      amount: parseFloat(amount),
      currency: "EUR",
      description: "Commande - La pause Fondante",
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
      
      // 3. ENVOI DE L'E-MAIL VIA EMAILJS DEPUIS LE SERVEUR
      const EMAILJS_SERVICE_ID = "service_cbfk3mr";
      const EMAILJS_TEMPLATE_ID = "template_g1uhwae";
      const EMAILJS_PUBLIC_KEY = "rnYePJTMswP2wkX6O";

      let articlesText = (cart || []).map(i => `• ${i.quantity}x ${i.title} (${i.subtitle || i.weight + 'g' || ''})`).join('\n');

      const emailParams = {
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: {
          to_email: "debstyle-coiffure@hotmail.com",
          client_email: clientEmail || "Non spécifié",
          client_name: clientName || "Client",
          client_phone: clientPhone || "Non renseigné",
          delivery_address: deliveryAddress || pointRelais,
          point_relais: pointRelais || "Non spécifié",
          articles_list: articlesText,
          subtotal: parseFloat(sousTotal || 0).toFixed(2).replace('.', ',') + " €",
          discount: discount || "0,00 €",
          shipping: estLivraisonOfferte ? "OFFERTS" : parseFloat(fraisDePort || 0).toFixed(2).replace('.', ',') + " €",
          total: parseFloat(amount).toFixed(2).replace('.', ',') + " €",
          date: new Date().toLocaleDateString('fr-FR')
        }
      };

      await fetch("https://api.emailjs.com/api/v1.0/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(emailParams)
      }).catch(err => console.error("Erreur d'envoi EmailJS serveur :", err));

      return res.status(200).json({ url: checkoutData.hosted_checkout_url });
    } else {
      return res.status(500).json({ error: checkoutData.message || "Erreur lors de la création du paiement SumUp." });
    }
  } catch (error) {
    console.error("Erreur serveur :", error);
    return res.status(500).json({ error: "Erreur serveur lors de la communication avec SumUp." });
  }
}