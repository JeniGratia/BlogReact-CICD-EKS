pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        timeout(time: 30, unit: 'MINUTES')
    }

    environment {
        APP_NAMESPACE  = 'blogapp'
        BACKEND_IMAGE  = 'blogreact-backend:local'
        FRONTEND_IMAGE = 'blogreact-frontend:local'
        NODE_IMAGE     = 'node:20-alpine'
        KIND_NODE      = 'blog-project-control-plane'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Backend Tests and Lint') {
            steps {
                dir('backend') {
                    sh '''
                        set -eu
                        CID=$(docker create -w /app "$NODE_IMAGE" \
                          sh -ec "npm install --no-package-lock --no-audit --no-fund && npm test && npm run lint")
                        trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

                        docker cp . "$CID":/app
                        docker start -a "$CID"
                    '''
                }
            }
        }

        stage('Frontend Lint and Build') {
            steps {
                dir('frontend') {
                    sh '''
                        set -eu
                        CID=$(docker create -w /app "$NODE_IMAGE" \
                          sh -ec "npm install --no-package-lock --no-audit --no-fund && npm run lint && npm run build")
                        trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

                        docker cp . "$CID":/app
                        docker start -a "$CID"
                    '''
                }
            }
        }

        stage('Build and Load Images') {
            steps {
                sh '''
                    set -eu

                    docker build --provenance=false -t "$BACKEND_IMAGE" ./backend
                    docker build --provenance=false -t "$FRONTEND_IMAGE" ./frontend

                    docker exec "$KIND_NODE" crictl images >/dev/null

                    docker save "$BACKEND_IMAGE" | \
                      docker exec -i "$KIND_NODE" ctr --namespace=k8s.io images import -
                    docker save "$FRONTEND_IMAGE" | \
                      docker exec -i "$KIND_NODE" ctr --namespace=k8s.io images import -

                    docker exec "$KIND_NODE" crictl images | grep blogreact
                '''
            }
        }

        stage('Validate Kubernetes Manifests') {
            steps {
                sh '''
                    set -eu

                    k() { docker exec -i "$KIND_NODE" kubectl --kubeconfig=/etc/kubernetes/admin.conf "$@"; }

                    echo "Preflight: kubectl and kubeconfig inside kind node..."
                    docker exec "$KIND_NODE" test -f /etc/kubernetes/admin.conf \
                      || { echo "ERROR: /etc/kubernetes/admin.conf missing in $KIND_NODE"; exit 1; }
                    docker exec "$KIND_NODE" which kubectl >/dev/null \
                      || { echo "ERROR: kubectl missing in $KIND_NODE"; exit 1; }

                    echo "Checking Kubernetes connectivity..."
                    k --request-timeout=15s get namespace "$APP_NAMESPACE"

                    for f in k8s/backend/deployment.yaml k8s/backend/service.yaml \
                             k8s/frontend/deployment.yaml k8s/frontend/service.yaml; do
                        echo "Validating $f"
                        k apply --dry-run=client -f - < "$f"
                    done
                '''
            }
        }

        stage('Deploy to Kubernetes') {
            steps {
                sh '''
                    set -eu

                    k() { docker exec -i "$KIND_NODE" kubectl --kubeconfig=/etc/kubernetes/admin.conf "$@"; }

                    for f in k8s/backend/deployment.yaml k8s/backend/service.yaml \
                             k8s/frontend/deployment.yaml k8s/frontend/service.yaml; do
                        echo "Applying $f"
                        k apply -f - < "$f"
                    done

                    k rollout restart deployment/backend  -n "$APP_NAMESPACE"
                    k rollout restart deployment/frontend -n "$APP_NAMESPACE"

                    k rollout status deployment/backend  -n "$APP_NAMESPACE" --timeout=180s
                    k rollout status deployment/frontend -n "$APP_NAMESPACE" --timeout=180s
                '''
            }
        }

        stage('Smoke Test') {
            steps {
                sh '''
                    set -eu

                    k() { docker exec -i "$KIND_NODE" kubectl --kubeconfig=/etc/kubernetes/admin.conf "$@"; }

                    k wait --for=condition=Available deployment/backend  -n "$APP_NAMESPACE" --timeout=120s
                    k wait --for=condition=Available deployment/frontend -n "$APP_NAMESPACE" --timeout=120s

                    POD="jenkins-smoke-${BUILD_NUMBER}"
                    trap 'k delete pod "$POD" -n "$APP_NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true' EXIT

                    k run "$POD" -n "$APP_NAMESPACE" \
                      --image=curlimages/curl:8.12.1 \
                      --restart=Never \
                      --command -- \
                      curl --fail --silent --show-error \
                      --retry 10 --retry-connrefused --retry-delay 2 \
                      http://frontend-service/api/healthz

                    k wait --for=jsonpath='{.status.phase}'=Succeeded \
                      pod/"$POD" -n "$APP_NAMESPACE" --timeout=120s \
                      || { k logs "$POD" -n "$APP_NAMESPACE" || true; exit 1; }

                    k logs "$POD" -n "$APP_NAMESPACE"
                    echo "Smoke test completed successfully."
                '''
            }
        }
    }

    post {
        success {
            echo 'Local CI/CD pipeline and smoke test succeeded.'
        }
        failure {
            echo 'Pipeline failed. Check the first failing stage and its error.'
        }
        always {
            echo 'Pipeline finished.'
        }
    }
}

