
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
        KUBECTL_IMAGE  = 'bitnami/kubectl:latest'
        KIND_NODE      = 'blog-project-control-plane'
        KUBE_CONFIG    = '/var/jenkins_home/.kube/config'
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

                        CID=$(docker create \
                          -w /app \
                          "$NODE_IMAGE" \
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

                        CID=$(docker create \
                          -w /app \
                          "$NODE_IMAGE" \
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

                    docker build --provenance=false \
                      -t "$BACKEND_IMAGE" ./backend

                    docker build --provenance=false \
                      -t "$FRONTEND_IMAGE" ./frontend

                    docker exec "$KIND_NODE" crictl images >/dev/null

                    docker save "$BACKEND_IMAGE" |
                      docker exec -i "$KIND_NODE" \
                      ctr --namespace=k8s.io images import -

                    docker save "$FRONTEND_IMAGE" |
                      docker exec -i "$KIND_NODE" \
                      ctr --namespace=k8s.io images import -

                    docker exec "$KIND_NODE" crictl images |
                      grep blogreact
                '''
            }
        }

        stage('Validate Kubernetes Manifests') {
            steps {
                sh '''
                    set -eu

                    test -f "$KUBE_CONFIG"

                    kubectl_docker() {
                        docker run --rm \
                          --network kind \
                          -v "$KUBE_CONFIG:/root/.kube/config:ro" \
                          -e KUBECONFIG=/root/.kube/config \
                          -v "$WORKSPACE:/workspace:ro" \
                          -w /workspace \
                          "$KUBECTL_IMAGE" "$@"
                    }

                    kubectl_docker --request-timeout=15s \
                      get namespace "$APP_NAMESPACE"

                    kubectl_docker apply --dry-run=client \
                      -f k8s/backend/deployment.yaml

                    kubectl_docker apply --dry-run=client \
                      -f k8s/backend/service.yaml

                    kubectl_docker apply --dry-run=client \
                      -f k8s/frontend/deployment.yaml

                    kubectl_docker apply --dry-run=client \
                      -f k8s/frontend/service.yaml
                '''
            }
        }

        stage('Deploy to Kubernetes') {
            steps {
                sh '''
                    set -eu

                    kubectl_docker() {
                        docker run --rm \
                          --network kind \
                          -v "$KUBE_CONFIG:/root/.kube/config:ro" \
                          -e KUBECONFIG=/root/.kube/config \
                          -v "$WORKSPACE:/workspace:ro" \
                          -w /workspace \
                          "$KUBECTL_IMAGE" "$@"
                    }

                    kubectl_docker apply -f k8s/backend/deployment.yaml
                    kubectl_docker apply -f k8s/backend/service.yaml
                    kubectl_docker apply -f k8s/frontend/deployment.yaml
                    kubectl_docker apply -f k8s/frontend/service.yaml

                    kubectl_docker rollout restart deployment/backend \
                      -n "$APP_NAMESPACE"

                    kubectl_docker rollout restart deployment/frontend \
                      -n "$APP_NAMESPACE"

                    kubectl_docker rollout status deployment/backend \
                      -n "$APP_NAMESPACE" --timeout=180s

                    kubectl_docker rollout status deployment/frontend \
                      -n "$APP_NAMESPACE" --timeout=180s
                '''
            }
        }

        stage('Smoke Test') {
            steps {
                sh '''
                    set -eu

                    kubectl_docker() {
                        docker run --rm \
                          --network kind \
                          -v "$KUBE_CONFIG:/root/.kube/config:ro" \
                          -e KUBECONFIG=/root/.kube/config \
                          "$KUBECTL_IMAGE" "$@"
                    }

                    kubectl_docker wait \
                      --for=condition=Available deployment/backend \
                      -n "$APP_NAMESPACE" --timeout=120s

                    kubectl_docker wait \
                      --for=condition=Available deployment/frontend \
                      -n "$APP_NAMESPACE" --timeout=120s

                    kubectl_docker run \
                      "jenkins-smoke-${BUILD_NUMBER}" \
                      -n "$APP_NAMESPACE" \
                      --image=curlimages/curl:8.12.1 \
                      --restart=Never \
                      --rm -i --quiet \
                      --command -- \
                      curl --fail --silent --show-error \
                      --retry 10 \
                      --retry-connrefused \
                      --retry-delay 2 \
                      http://frontend-service/api/healthz
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
