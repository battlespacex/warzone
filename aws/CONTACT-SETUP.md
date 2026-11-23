# StratOps public contact form, AWS deployment

This code uses the same overall pattern as the provided Aerocism reference (browser form -> API Gateway -> Lambda -> email), but it must use a **separate StratOps API**, not Aerocism's existing endpoint.

## What you must configure in AWS

- **Amazon SES** in one chosen AWS Region, e.g. `us-east-1`: verify `contact@stratops.space` as an individual identity, or verify the `stratops.space` domain and DKIM records. Keep your existing domain mail provider's MX records intact. SES sending verification does not require moving your incoming mailbox.
- If SES is in the sandbox, the `bravo@battlespacex.com` receiving address/domain must also be verified; for real external recipients and growth, request production access where needed.
- An **existing private deployment S3 bucket** for storing the Lambda ZIP. This is **not** the public `stratops.space` website bucket unless you intentionally store deployment packages outside the public-serving path and lock down access.
- **AWS CLI** logged into an account/profile with permission for CloudFormation, IAM, Lambda, API Gateway, SES, DynamoDB and S3.
- A random CAPTCHA secret of 32+ characters. Do not put it in frontend JavaScript, marketing `contact.json` or public S3.

## Windows PowerShell: package the Lambda

From your StratOps repository root (where `package.json` lives):

```powershell
cd aws\contact-lambda
npm install --omit=dev
Compress-Archive -Path handler.mjs,lib.mjs,package.json,node_modules -DestinationPath ..\stratops-contact-lambda.zip -Force
cd ..\..
```

The archive root must contain `handler.mjs` and `lib.mjs`, not a wrapper `contact-lambda/` directory. The Lambda ZIP is separate from the public marketing Webpack bundle.

## Upload Lambda package and deploy stack

Replace YOUR_BUCKET with an existing private deployment artifact bucket and choose the Region used for SES. The following is an example; don't paste literal placeholders into a production command.

```powershell
aws s3 cp aws\stratops-contact-lambda.zip s3://YOUR_BUCKET/stratops-contact/stratops-contact-lambda.zip --region us-east-1
```

Create a secure random secret (example PowerShell using Node.js):

```powershell
$captchaSecret = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
```

Then deploy the stack; ensure you use the exact SES-verified sender and identity:

```powershell
aws cloudformation deploy `
  --template-file aws/contact-stack.yaml `
  --stack-name stratops-public-contact `
  --capabilities CAPABILITY_IAM `
  --region us-east-1 `
  --parameter-overrides `
    ArtifactBucket=YOUR_BUCKET `
    ArtifactKey=stratops-contact/stratops-contact-lambda.zip `
    SenderEmail=contact@stratops.space `
    SesIdentity=stratops.space `
    RecipientEmail=bravo@battlespacex.com `
    CaptchaSecret=$captchaSecret
```

**Security:** The secret is held in a local PowerShell variable and passed to a `NoEcho` CloudFormation parameter. Use an appropriately protected AWS workstation and secret-management process; avoid command transcript logging. IAM role permissions are limited to SES send from your verified identity and writes to the challenge table. Rotate the secret if exposed (active challenges will expire).

Retrieve the API URL:

```powershell
aws cloudformation describe-stacks --stack-name stratops-public-contact --region us-east-1 --query "Stacks[0].Outputs[?OutputKey=='ContactApiUrl'].OutputValue" --output text
```

It will resemble `https://XXXXXXXX.execute-api.us-east-1.amazonaws.com`. Don't use Aerocism's API. Configure:

```json
{
  "contactApiBaseUrl": "https://XXXXXXXX.execute-api.us-east-1.amazonaws.com"
}
```

Edit `dev/marketing/config/contact.json` with your actual output. This is a **public URL**, not a secret. The secret stays in Lambda configuration. Do not add API keys or IAM credentials to frontend code.

## Test before publishing

1. Run `npm run dev:marketing`. Open `http://localhost:4174/contact/`. You should see a math question loaded from the real API.
2. Enter a valid name, email, selected enquiry type and 15+ character message. Solve the sum, then submit.
3. Verify a success message **and** receipt in `bravo@battlespacex.com` (including its spam folder). The AWS API only reports success after SES returns a message ID, which means SES accepted it for delivery, not guaranteed final inbox delivery.
4. Test an incorrect answer, reused answer, missing field and an unavailable API. Each should show a clear error, with no fake success response.
5. Run `npm run build`. Deploy **only `public-site/`** to your `stratops.space` bucket. Invalidate the marketing CloudFront cache, and retest `https://stratops.space/contact/`.
6. Set up CloudWatch alerts / monitor SES sending and bounce metrics if you need consistent operational delivery.

## Abuse protection and limitations

- Challenge issued by Lambda, HMAC signed, expires after five minutes, not reusable (nonce stored in DynamoDB with TTL).
- CAPTCHA is invalid if submitted unrealistically fast (under ~1.8 seconds) or after expiry.
- Honeypot `website` field must remain empty; user input lengths and email/topic are checked again on the server.
- API Gateway `Stage` throttling is set to a low default globally (2 requests/sec, burst 5). You can tune it based on actual traffic; do not assume it is a per-IP spam cap.
- Solving addition is trivial for sophisticated bots. For persistent spam, put the contact API behind an appropriate stronger bot-protection system or add a managed challenge before using it for high-volume public submissions.
- Recipient mailbox and SES DNS configuration are not altered automatically by the marketing HTML or `npm run build`.
- CloudFormation deployment requires real AWS permissions and billing. No AWS resources are created merely by extracting this ZIP.

AWS documentation:

- SES email identities: https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html
- SES sandbox restrictions: https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html
- Lambda ZIP packages: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-package.html
- HTTP API CORS: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-cors.html
