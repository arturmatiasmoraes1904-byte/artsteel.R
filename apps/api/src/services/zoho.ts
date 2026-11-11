export async function syncContactToZoho(email: string, name: string, dataFimContrato: string) {
  // Para que isso funcione, você precisará adicionar estas variáveis no seu arquivo .env:
  // ZOHO_CAMPAIGNS_CLIENT_ID, ZOHO_CAMPAIGNS_CLIENT_SECRET, ZOHO_CAMPAIGNS_REFRESH_TOKEN, ZOHO_CAMPAIGNS_LIST_KEY
  
  const listKey = process.env.ZOHO_CAMPAIGNS_LIST_KEY;
  if (!listKey) {
    console.log('[ZOHO] Integração pulada: Chave da lista não configurada.');
    return;
  }

  try {
    // 1. Obter o token de acesso (OAuth2)
    // Esse passo é necessário pois o token expira a cada hora
    const tokenParams = new URLSearchParams({
      refresh_token: process.env.ZOHO_CAMPAIGNS_REFRESH_TOKEN || '',
      client_id: process.env.ZOHO_CAMPAIGNS_CLIENT_ID || '',
      client_secret: process.env.ZOHO_CAMPAIGNS_CLIENT_SECRET || '',
      grant_type: 'refresh_token'
    });

    const tokenResponse = await fetch('https://accounts.zoho.com/oauth/v2/token', {
      method: 'POST',
      body: tokenParams
    });
    const tokenData = await tokenResponse.json();
    
    if (!tokenData.access_token) {
      throw new Error('Falha ao obter token do Zoho');
    }

    // 2. Adicionar/Atualizar contato na lista do Zoho Campaigns
    const [firstName, ...lastNames] = name.split(' ');
    
    // Convertemos a data do banco (YYYY-MM-DD) para o formato esperado pelo Zoho (MM/dd/yyyy)
    const [year, month, day] = dataFimContrato.split('-');
    const zohoDate = `${month}/${day}/${year}`;

    const contactData = {
      "Contact Email": email,
      "First Name": firstName,
      "Last Name": lastNames.join(' ') || ' ',
      // Certifique-se de que o nome da variável ("Vencimento do Contrato")
      // corresponde exatamente ao nome que você criou nas configurações do Zoho:
      "Vencimento do Contrato": zohoDate
    };

    const campaignResponse = await fetch(`https://campaigns.zoho.com/api/v1.1/json/listsubscribe?resfmt=JSON&listkey=${listKey}&contactinfo=${encodeURIComponent(JSON.stringify(contactData))}`, {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${tokenData.access_token}`
      }
    });

    const campaignData = await campaignResponse.json();
    console.log(`[ZOHO] Contato sincronizado: ${email}`, campaignData.message || campaignData);

  } catch (error) {
    console.error('[ZOHO ERROR] Falha ao sincronizar contato:', error);
  }
}
