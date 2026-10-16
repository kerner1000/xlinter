apply-traefik-config-docflow-prod: docflow-prod-guard
	@kubectl apply -f clusters/cloudscale-docflow-prod/traefik-config.yaml

apply-cluster-docflow-prod: docflow-prod-guard apply-cert-manager-docflow-prod apply-traefik-config-docflow-prod
	@echo done
