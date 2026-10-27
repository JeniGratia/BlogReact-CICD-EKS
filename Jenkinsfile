pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        timeout(time: 30, unit: 'MINUTES')
    }

    environment {
        APP_NAMESPACE = 'blogapp'
        BACKEND_IMAGE = 'blogreact-backend:local'
        FRONTEND_IMAGE = 'blogreact-frontend:local'
        NODE_IMAGE = 'node:20-alpine'
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
                        ls -la   # debug: confirm package.json exists in the workspace

                        cid=$(docker create -w /app "$NODE_IMAGE" sh -ec \
                          "npm install --no-package-lock --no-audit --no-fund && npm test && npm run lint")
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
                        ls -la

                        cid=$(docker create -w /app "$NODE_IMAGE" sh -ec \
                          "npm install --no-package-lock --no-audit --no-fund && npm run lint && npm run build")
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
                    docker build -t "$BACKEND_IMAGE" ./backend
                    docker build -t "$FRONTEND_IMAGE" ./frontend

                    docker exec blog-project-control-plane \
                      crictl images >/dev/null

                    kind load docker-image "$BACKEND_IMAGE" \
                      --name blog-project
                    kind load docker-image "$FRONTEND_IMAGE" \
                      --name blog-project
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

