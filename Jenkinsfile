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
                        cid=$(docker create -w /app "$NODE_IMAGE" sh -ec \
                          "npm ci --no-audit --no-fund && npm test && npm run lint")
                        trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT

                        docker cp . "$cid":/app
                        docker start -a "$cid"
                    '''
                }
            }
        }

        stage('Frontend Lint and Build') {
            steps {
                dir('frontend') {
                    sh '''
                        set -eu
                        cid=$(docker create -w /app "$NODE_IMAGE" sh -ec \
                          "npm ci --no-audit --no-fund && npm run lint && npm run build")
                        trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT

                        docker cp . "$cid":/app
                        docker start -a "$cid"
                    '''
                }
            }
        }

        stage('Build Images') {
            steps {
                sh '''
                    set -eu
                    docker build --provenance=false -t "$BACKEND_IMAGE" ./backend
                    docker build --provenance=false -t "$FRONTEND_IMAGE" ./frontend

                    # Check the kind node container is reachable
                    docker exec "$KIND_NODE" crictl images >/dev/null

                    # Load images into the kind node (same as "kind load docker-image")
                    docker save "$BACKEND_IMAGE" | \
                      docker exec -i "$KIND_NODE" ctr --namespace=k8s.io images import -
                    docker save "$FRONTEND_IMAGE" | \
                      docker exec -i "$KIND_NODE" ctr --namespace=k8s.io images import -

                    docker exec "$KIND_NODE" crictl images | grep blogreact
                '''
            }
        }

        stage('Validate Manifests') {
            steps {
                sh '''
                    set -eu
                    kubectl apply --dry-run=client -f k8s/backend/deployment.yaml
                    kubectl apply --dry-run=client -f k8s/backend/service.yaml
                    kubectl apply --dry-run=client -f k8s/frontend/deployment.yaml
                    kubectl apply --dry-run=client -f k8s/frontend/service.yaml
                '''
            }
        }

        stage('Deploy') {
            steps {
                sh '''
                    set -eu

                    kubectl apply -f k8s/backend/deployment.yaml
                    kubectl apply -f k8s/backend/service.yaml
                    kubectl apply -f k8s/frontend/deployment.yaml
                    kubectl apply -f k8s/frontend/service.yaml

                    # Restart so pods pick up the freshly loaded :local images
                    kubectl rollout restart deployment/backend  -n "$APP_NAMESPACE"
                    kubectl rollout restart deployment/frontend -n "$APP_NAMESPACE"

                    kubectl rollout status deployment/backend \
                      -n "$APP_NAMESPACE" --timeout=180s
                    kubectl rollout status deployment/frontend \
                      -n "$APP_NAMESPACE" --timeout=180s
                '''
            }
        }

        stage('Smoke Test') {
            steps {
                sh '''
                    set -eu

                    kubectl wait --for=condition=Available \
                      deployment/backend -n "$APP_NAMESPACE" --timeout=120s
                    kubectl wait --for=condition=Available \
                      deployment/frontend -n "$APP_NAMESPACE" --timeout=120s

                    kubectl run "jenkins-smoke-${BUILD_NUMBER}" \
                      -n "$APP_NAMESPACE" \
                      --image=curlimages/curl:8.12.1 \
                      --restart=Never \
                      --rm -i --quiet \
                      --command -- \
                      curl --fail --silent --show-error \
                      --retry 10 --retry-connrefused \
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
            echo 'Pipeline failed. Check the first failing stage.'
        }
        always {
            echo 'Pipeline finished.'
        }
    }
}

