# Secret Rotation Playbook

The APGMS AWS deployment uses AWS Secrets Manager for database credentials and mutual TLS materials. Follow this guide to rotate without downtime.

## 1. Database credentials
1. Navigate to the `apgms/<env>/database` secret in Secrets Manager.
2. Choose **Rotate secret**, enable rotation, and select/create a rotation Lambda using the AWS provided PostgreSQL single-user template.
3. Update the Lambda with VPC access to the `PrivateApp` subnets and security group permitting PostgreSQL connections.
4. Initiate rotation. The Lambda will create a new password, update PostgreSQL, and set the new version as `AWSCURRENT`.
5. ECS tasks automatically refresh credentials on next retrieval. Force recycle tasks to accelerate the process:
   ```sh
   aws ecs update-service --cluster <cluster> --service <service> --force-new-deployment
   ```

## 2. mTLS certificate bundle
1. Prepare new PEM files for the client CA, server certificate, and private key.
2. Use the following command to update the JSON secret without exposing plaintext in code:
   ```sh
   aws secretsmanager put-secret-value \
     --secret-id apgms/<env>/mtls \
     --secret-string '{"clientCa":"<base64-pem>","certificate":"<base64-pem>","privateKey":"<base64-pem>"}'
   ```
   Encode each PEM payload with base64 to avoid escaping issues.
3. Trigger a new ECS deployment (as above) to ensure containers reload the updated secrets.
4. Validate mutual TLS from a client using the rotated certificate.

## 3. Audit
- Ensure CloudTrail logging captures the rotation events.
- Record the rotation in the security change log with the ticket ID, operator, and validation evidence.
