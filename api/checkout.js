export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { amount, sousTotal, fraisDePort, estLivraisonOfferte, pointRelais, clientEmail, cart } = req.body || {};
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
      // 3. Envoi automatique de l'e-mail de récapitulatif via Resend (si configuré)
      if (process.env.RESEND_API_KEY) {
        const detailsArticles = (cart || []).map(item => `
          <li style="margin-bottom: 6px;">
            <strong>${item.quantity}x ${item.title}</strong><br/>
            <span style="color: #666; font-size: 13px;">${item.subtitle}</span>
          </li>
        `).join('');

        const emailHtml = `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2 style="color: #6b7f71;">Nouvelle commande — La pause Fondante</h2>
            <p><strong>Client :</strong> ${clientEmail || 'Non spécifié'}</p>
            <p><strong>Point Relais souhaité :</strong> <span style="color: #c88b4a; font-weight: bold;">${pointRelais || 'Non spécifié'}</span></p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 15px 0;" />
            <h3>Détails du panier :</h3>
            <ul>${detailsArticles}</ul>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 15px 0;" />
            <p>Sous-total articles : ${parseFloat(sousTotal || 0).toFixed(2).replace('.', ',')} €</p>
            <p>Frais de port point relais : ${estLivraisonOfferte ? '<strong>OFFERTS</strong>' : parseFloat(fraisDePort || 0).toFixed(2).replace('.', ',') + ' €'}</p>
            <p style="font-size: 18px; color: #c88b4a;"><strong>Total de la commande : ${parseFloat(amount).toFixed(2).replace('.', ',')} €</strong></p>
          </div>
        `;

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: "La pause Fondante <onboarding@resend.dev>",
            to: ["debstyle-coiffure@hotmail.com", "renaut.lucas@outlook.fr"],
            subject: `Nouvelle commande (${parseFloat(amount).toFixed(2).replace('.', ',')} €) - Point Relais`,
            html: emailHtml
          })
        }).catch(err => console.error("Erreur d'envoi d'email :", err));
      }

      return res.status(200).json({ url: checkoutData.hosted_checkout_url });
    } else {
      return res.status(500).json({ error: checkoutData.message || "Erreur lors de la création du paiement SumUp." });
    }
  } catch (error) {
    console.error("Erreur serveur :", error);
    return res.status(500).json({ error: "Erreur serveur lors de la communication avec SumUp." });
  }
}