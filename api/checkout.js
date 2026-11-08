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
      
      // 3. ENVOI DE LA NOTIFICATION DE COMMANDE SUR TA BOÎTE MAIL VIA RESEND
      const resendApiKey = process.env.RESEND_API_KEY;

      if (resendApiKey) {
        const detailsArticles = (cart || []).map(item => `
          <tr style="border-bottom: 1px solid #eadfcf;">
            <td style="padding: 10px 0; color: #2d312e;">
              <strong style="color: #3e4b42;">${item.quantity}x ${item.title}</strong><br/>
              <span style="font-size: 12px; color: #777;">${item.subtitle || ''}</span>
            </td>
            <td align="right" style="padding: 10px 0; font-weight: bold; color: #c88b4a; white-space: nowrap;">
              ${(item.price * item.quantity).toFixed(2).replace('.', ',')} €
            </td>
          </tr>
        `).join('');

        const emailHtml = `
          <!DOCTYPE html>
          <html lang="fr">
          <head><meta charset="UTF-8"/></head>
          <body style="margin: 0; padding: 0; background-color: #fbf9f5; font-family: Arial, sans-serif; color: #2d312e;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #fbf9f5; padding: 20px 10px;">
              <tr>
                <td align="center">
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; border: 1px solid #eadfcf; overflow: hidden;">
                    
                    <!-- EN-TÊTE -->
                    <tr>
                      <td style="background-color: #6b7f71; padding: 20px 25px; color: #ffffff;">
                        <h2 style="margin: 0; font-size: 20px; font-weight: bold;">🚨 Nouvelle commande à préparer !</h2>
                        <p style="margin: 5px 0 0 0; font-size: 13px; color: #e4ebe4;">La Pause Fondante — ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
                      </td>
                    </tr>

                    <!-- COORDONNÉES CLIENT & LIVRAISON -->
                    <tr>
                      <td style="padding: 25px;">
                        
                        <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #3e4b42; text-transform: uppercase; letter-spacing: 0.5px;">
                          👤 Coordonnées du Client
                        </h3>
                        <div style="background-color: #fbf9f5; border: 1px solid #e4ebe4; border-radius: 10px; padding: 15px; font-size: 13px; line-height: 1.6; margin-bottom: 20px;">
                          <p style="margin: 0 0 6px 0;"><strong>Nom :</strong> ${clientName || 'Non renseigné'}</p>
                          <p style="margin: 0 0 6px 0;"><strong>E-mail client :</strong> <a href="mailto:${clientEmail}" style="color: #6b7f71; font-weight: bold;">${clientEmail || 'Non renseigné'}</a></p>
                          <p style="margin: 0;"><strong>Téléphone :</strong> <a href="tel:${clientPhone}" style="color: #6b7f71; font-weight: bold;">${clientPhone || 'Non renseigné'}</a></p>
                        </div>

                        <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #3e4b42; text-transform: uppercase; letter-spacing: 0.5px;">
                          📦 Adresse & Point Relais
                        </h3>
                        <div style="background-color: #fdf9f3; border: 1px solid #efd9b7; border-radius: 10px; padding: 15px; font-size: 13px; line-height: 1.6; margin-bottom: 25px;">
                          <p style="margin: 0 0 8px 0;"><strong>Adresse postale client :</strong><br/>${deliveryAddress || 'Non renseignée'}</p>
                          <p style="margin: 0; color: #a66e35;"><strong>Mode / Point Relais choisi :</strong><br/><strong>${pointRelais || 'Livraison à domicile'}</strong></p>
                        </div>

                        <!-- ARTICLES -->
                        <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #3e4b42; text-transform: uppercase; letter-spacing: 0.5px;">
                          🛒 Articles commandés
                        </h3>
                        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="font-size: 13px; margin-bottom: 20px;">
                          ${detailsArticles}
                        </table>

                        <!-- TOTAL -->
                        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-top: 2px solid #6b7f71; padding-top: 15px; font-size: 13px;">
                          <tr>
                            <td style="padding: 4px 0; color: #666;">Sous-total articles :</td>
                            <td align="right" style="font-weight: bold;">${parseFloat(sousTotal || 0).toFixed(2).replace('.', ',')} €</td>
                          </tr>
                          <tr>
                            <td style="padding: 4px 0; color: #666;">Réduction :</td>
                            <td align="right" style="font-weight: bold; color: #c88b4a;">${discount || '0,00 €'}</td>
                          </tr>
                          <tr>
                            <td style="padding: 4px 0; color: #666;">Frais de port :</td>
                            <td align="right" style="font-weight: bold;">
                              ${estLivraisonOfferte ? '<span style="color: #6b7f71;">OFFERTS</span>' : parseFloat(fraisDePort || 0).toFixed(2).replace('.', ',') + ' €'}
                            </td>
                          </tr>
                          <tr>
                            <td style="padding: 12px 0 0 0; font-size: 16px; font-weight: bold; color: #3e4b42;">TOTAL À ENCAISSER :</td>
                            <td align="right" style="padding: 12px 0 0 0; font-size: 20px; font-weight: bold; color: #c88b4a;">
                              ${parseFloat(amount).toFixed(2).replace('.', ',')} €
                            </td>
                          </tr>
                        </table>

                      </td>
                    </tr>

                  </table>
                </td>
              </tr>
            </table>
          </body>
          </html>
        `;

        try {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${resendApiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              from: "La pause Fondante <onboarding@resend.dev>",
              to: ["debstyle-coiffure@hotmail.com"], // Envoi exclusif à ton adresse
              subject: `🔔 NOUVELLE COMMANDE (${parseFloat(amount).toFixed(2).replace('.', ',')} €) - ${clientName || 'Client'}`,
              html: emailHtml
            })
          });
        } catch (err) {
          console.error("Erreur d'envoi d'email Resend :", err);
        }
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