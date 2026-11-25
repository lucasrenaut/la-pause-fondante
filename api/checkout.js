const SUPABASE_URL = "https://ewmdyjcjxwibhfjejhwe.supabase.co";

async function deduireStocksServeur(cart, supabaseServiceKey) {
  if (!Array.isArray(cart) || !supabaseServiceKey) return;
  const lignes = [];

  cart.forEach(item => {
    if (item.type === 'lot' && item.parfums) {
      Object.entries(item.parfums).forEach(([parfumId, qte]) => {
        if (qte > 0) lignes.push({ id: `fondant-${parfumId}`, qte: qte * item.quantity });
      });
    } else if (item.type === 'tablette') {
      lignes.push({ id: `tablette-${item.parfumId}`, qte: item.quantity });
    } else if (item.type === 'plateau') {
      lignes.push({ id: item.plateauId, qte: item.quantity });
    } else if (item.type === 'creation') {
      lignes.push({ id: item.creationId, qte: item.quantity });
    } else if (item.type === 'mystere') {
      lignes.push({ id: 'lot-mystere', qte: item.quantity });
    }
  });

  for (const ligne of lignes) {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/decrementer_stock`, {
      method: "POST",
      headers: {
        "apikey": supabaseServiceKey,
        "Authorization": `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ p_id: ligne.id, p_qte: ligne.qte })
    });
  }
}

async function envoyerEmailCommande(orderData) {
  if (!orderData) return;

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
    minute: '2-digit',
    timeZone: 'Europe/Paris'
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

  const emailjsRes = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(emailjsPayload)
  });

  if (!emailjsRes.ok) {
    const errorDetails = await emailjsRes.text();
    console.error("Échec envoi EmailJS :", emailjsRes.status, errorDetails);
  }
}

async function finaliserCommandeSiNonTraitee(checkoutId, supabaseServiceKey) {
  const patchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/commandes_sumup?checkout_id=eq.${encodeURIComponent(checkoutId)}&statut=eq.PENDING`,
    {
      method: "PATCH",
      headers: {
        "apikey": supabaseServiceKey,
        "Authorization": `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        statut: "PAID",
        paid_at: new Date().toISOString()
      })
    }
  );

  if (!patchRes.ok) {
    console.error("Erreur Supabase PATCH :", await patchRes.text());
    return false;
  }

  const updatedRows = await patchRes.json();
  if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
    return true;
  }

  const orderData = updatedRows[0].order_data;
  await deduireStocksServeur(orderData.cart, supabaseServiceKey);
  await envoyerEmailCommande(orderData);
  return true;
}

async function obtenirMerchantCode(apiKey) {
  if (process.env.SUMUP_MERCHANT_CODE) {
    return process.env.SUMUP_MERCHANT_CODE.trim();
  }
  const meRes = await fetch("https://api.sumup.com/v0.1/me", {
    headers: { "Authorization": `Bearer ${apiKey}` }
  });
  if (!meRes.ok) return null;
  const meData = await meRes.json();
  return meData?.merchant_profile?.merchant_code || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const apiKey = process.env.SUMUP_API_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey || !supabaseServiceKey) {
    return res.status(500).json({ error: "Variables d'environnement manquantes sur Vercel." });
  }

  const { action, amount, returnUrl, orderData, checkoutId } = req.body || {};

  try {
    // 1. CRÉATION DU CHECKOUT SUMUP
    if (action === 'create') {
      const montant = Number(parseFloat(amount).toFixed(2));
      if (!Number.isFinite(montant) || montant < 1) {
        return res.status(400).json({ error: "Le montant minimum pour payer par carte est de 1,00 €." });
      }

      const merchantCode = await obtenirMerchantCode(apiKey);
      if (!merchantCode && !process.env.SUMUP_PAY_TO_EMAIL) {
        return res.status(500).json({ error: "Impossible de récupérer le code marchand SumUp." });
      }

      const redirectUrl = returnUrl
        ? `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}sumup_return=1`
        : "https://la-pause-fondante.vercel.app/paiement.html?sumup_return=1";
      const origin = returnUrl ? new URL(returnUrl).origin : "https://la-pause-fondante.vercel.app";

      const sumupBody = {
        checkout_reference: `LPF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        amount: montant,
        currency: "EUR",
        description: "Commande La Pause Fondante",
        return_url: `${origin}/api/webhook`,
        redirect_url: redirectUrl,
        hosted_checkout: { enabled: true }
      };

      if (merchantCode) {
        sumupBody.merchant_code = merchantCode;
      } else {
        sumupBody.pay_to_email = process.env.SUMUP_PAY_TO_EMAIL.trim();
      }

      const sumupRes = await fetch("https://api.sumup.com/v0.1/checkouts", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(sumupBody)
      });

      const sumupData = await sumupRes.json();

      if (!sumupRes.ok || !sumupData.id || !sumupData.hosted_checkout_url) {
        console.error("Erreur création SumUp :", sumupRes.status, sumupData);
        return res.status(502).json({
          error: sumupData.message || sumupData.error_message || "SumUp n'a pas pu créer la session de paiement."
        });
      }

      // Enregistrement de la commande en attente dans Supabase
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/commandes_sumup`, {
        method: "POST",
        headers: {
          "apikey": supabaseServiceKey,
          "Authorization": `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          checkout_id: sumupData.id,
          statut: "PENDING",
          order_data: orderData
        })
      });

      if (!insertRes.ok) {
        console.error("Erreur insertion commandes_sumup :", await insertRes.text());
      }

      return res.status(200).json({
        checkoutId: sumupData.id,
        url: sumupData.hosted_checkout_url
      });
    }

    // 2. VÉRIFICATION DU PAIEMENT AU RETOUR DE SUMUP
    if (action === 'verify') {
      if (!checkoutId) {
        return res.status(400).json({ error: "Identifiant checkout absent." });
      }

      const checkRes = await fetch(`https://api.sumup.com/v0.1/checkouts/${encodeURIComponent(checkoutId)}`, {
        headers: { "Authorization": `Bearer ${apiKey}` }
      });
      const checkData = await checkRes.json();

      if (checkRes.ok && checkData.status === 'PAID') {
        await finaliserCommandeSiNonTraitee(checkoutId, supabaseServiceKey);
        return res.status(200).json({ paid: true, status: checkData.status });
      }

      return res.status(200).json({ paid: false, status: checkData.status || 'PENDING' });
    }

    return res.status(400).json({ error: "Action invalide." });
  } catch (error) {
    console.error("Erreur serveur /api/checkout :", error);
    return res.status(500).json({ error: "Erreur serveur lors du paiement." });
  }
}